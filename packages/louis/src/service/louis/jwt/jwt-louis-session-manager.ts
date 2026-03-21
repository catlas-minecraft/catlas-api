import { type Context, DateTime, Duration, Effect, Option } from "effect";
import type { SessionJwt } from "../../../domain/model/session/value-object/session-jwt.ts";
import type { BaseSessionContext, LouisSessionManager } from "../louis-session-manager.ts";
import type { SessionRepositoryInterface } from "../../../domain/repository.ts";
import type { UnknownRepositoryError } from "../../../domain/repository-errors.ts";
import { JwtService } from "./jwt-service.ts";
import type { JwtInvalidError, JwtSignError, JwtVerifyError } from "./jwt-service.ts";
import { InternalError, InvalidSessionTokenError } from "../../../domain/error.ts";
import { make as makeLouisSessionManager } from "../louis-session-manager.ts";
import { parseSessionToken } from "../../../domain/model/session/value-object/session-token.ts";
import { dateTime2Epoch } from "../../../utils.ts";

export type SessionUsedResult<OrganizationId extends string, UserId extends string> =
  | SessionResultNeedRefreshJwt<OrganizationId, UserId>
  | {
      session: BaseSessionContext<OrganizationId, UserId>;
      sessionJwt: Option.None<SessionJwt>;
    };

type SessionResultNeedRefreshJwt<OrganizationId extends string, UserId extends string> = {
  session: BaseSessionContext<OrganizationId, UserId>;
  sessionJwt: Option.Some<SessionJwt>;
};

export interface JwtLouisSessionManager<
  OrganizationId extends string,
  UserId extends string,
> extends LouisSessionManager<OrganizationId, UserId> {
  createSessionAsJwt: (
    organizationId: OrganizationId,
    userId: UserId,
  ) => Effect.Effect<
    SessionResultNeedRefreshJwt<OrganizationId, UserId>,
    UnknownRepositoryError | InternalError
  >;

  useSessionWithJwt: (
    jwt: SessionJwt,
    organizationId: OrganizationId,
  ) => Effect.Effect<
    Option.Option<SessionUsedResult<OrganizationId, UserId>>,
    | InternalError
    | JwtVerifyError
    | JwtInvalidError
    | UnknownRepositoryError
    | InvalidSessionTokenError
    | JwtSignError
  >;

  revokeSessionWithJwt: (
    jwt: SessionJwt,
  ) => Effect.Effect<
    void,
    InternalError | JwtInvalidError | UnknownRepositoryError | InvalidSessionTokenError
  >;
}

/**
 * JwtLouisSessionManagerを生成する
 */
export const make = Effect.fn(function* <
  OrganizationId extends string,
  UserId extends string,
  SessionRepositoryTag extends SessionRepositoryInterface<OrganizationId, UserId> =
    SessionRepositoryInterface<OrganizationId, UserId>,
>({
  sessionRefreshDuration = Duration.hours(1),
  sessionExpireDuration = Duration.weeks(1),
  SessionRepository,
}: {
  sessionRefreshDuration?: Duration.Duration;
  sessionExpireDuration?: Duration.Duration;
  SessionRepository: Context.Tag<
    SessionRepositoryTag,
    SessionRepositoryInterface<OrganizationId, UserId>
  >;
}) {
  const jwtService = yield* JwtService;

  // Base LouisSessionManager implementation
  const baseManager = yield* makeLouisSessionManager<OrganizationId, UserId, SessionRepositoryTag>({
    sessionRefreshDuration,
    sessionExpireDuration,
    SessionRepository,
  });

  return {
    ...baseManager,
    createSessionAsJwt: Effect.fn(function* (organizationId: OrganizationId, userId: UserId) {
      const sessionContext = yield* baseManager.createSession(organizationId, userId);

      // Create JWT with sessionId as payload
      const sessionJwt = yield* jwtService
        .sign({
          stk: sessionContext.sessionToken,
          oid: organizationId,
          uid: userId,
          exp: sessionContext.expiresAt.pipe(dateTime2Epoch),
          iat: sessionContext.createdAt.pipe(dateTime2Epoch),
        })
        .pipe(InternalError.from((error) => error.message));

      return {
        session: {
          sessionId: sessionContext.sessionId,
          organizationId,
          userId,
          createdAt: sessionContext.createdAt,
          expiresAt: sessionContext.expiresAt,
        },
        sessionJwt: Option.some(sessionJwt) as Option.Some<SessionJwt>,
      };
    }),
    useSessionWithJwt: Effect.fn(function* (jwt, organizationId) {
      const verifyResult: Option.Option<SessionUsedResult<OrganizationId, UserId>> =
        yield* jwtService.verify(jwt).pipe(
          Effect.flatMap(
            Effect.fn(function* ({ stk, oid, uid: sub, iat, exp }) {
              if (!iat || !exp) {
                // If timestamps are missing in JWT, we cannot return a valid session context without DB lookup.
                // We could fallback to DB here, or return None to force re-verification?
                // Let's assume valid session JWTs must have timestamps.
                // If not, we fail verification effectively.
                return Option.none();
              }

              if (oid !== organizationId) {
                return yield* new InvalidSessionTokenError({
                  message: "Organization ID does not match",
                });
              }

              const { sessionId } = yield* parseSessionToken(stk);

              return Option.some({
                session: {
                  sessionId,
                  organizationId: oid as OrganizationId,
                  userId: sub as UserId,
                  createdAt: DateTime.unsafeMake(iat * 1000), // JWT uses seconds
                  expiresAt: DateTime.unsafeMake(exp * 1000), // JWT uses seconds
                },
                sessionJwt: Option.none() as Option.None<SessionJwt>,
              } satisfies SessionUsedResult<OrganizationId, UserId>);
            }),
          ),
          Effect.catchTags({
            JwtExpiredError: Effect.fn(function* () {
              const { stk: sessionToken } = yield* jwtService.unsafeDecode(jwt);

              const sessionContext = yield* baseManager.useSession(sessionToken, organizationId);

              if (Option.isNone(sessionContext)) return Option.none();

              const newJwt = yield* jwtService.sign({
                stk: sessionToken,
                oid: organizationId,
                uid: sessionContext.value.userId,
              });

              return Option.some({
                session: {
                  sessionId: sessionContext.value.sessionId,
                  organizationId,
                  userId: sessionContext.value.userId,
                  createdAt: sessionContext.value.createdAt,
                  expiresAt: sessionContext.value.expiresAt,
                },
                sessionJwt: Option.some(newJwt) as Option.Some<SessionJwt>,
              } satisfies SessionResultNeedRefreshJwt<OrganizationId, UserId>);
            }),
          }),
        );

      return verifyResult;
    }),
    revokeSessionWithJwt: Effect.fn(function* (jwt) {
      const { stk } = yield* jwtService.unsafeDecode(jwt);
      yield* baseManager.revokeSession(stk);
    }),
  } satisfies JwtLouisSessionManager<OrganizationId, UserId>;
});
