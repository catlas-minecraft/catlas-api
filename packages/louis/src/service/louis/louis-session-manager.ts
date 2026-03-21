import { type Context, DateTime, Duration, Effect, Option } from "effect";
import type { SessionRepositoryInterface } from "../../domain/repository.ts";
import { constantTimeEqual } from "@oslojs/crypto/subtle";
import { decodeHex } from "effect/Encoding";
import {
  SessionId,
  SessionSecret,
  SessionToken,
} from "../../domain/model/session/value-object/mod.ts";
import type { UnknownRepositoryError } from "../../domain/repository-errors.ts";
import { parseSessionToken } from "../../domain/model/session/value-object/session-token.ts";
import { InternalError, InvalidSessionTokenError } from "../../domain/error.ts";
import { hash } from "../../domain/model/session/value-object/session-secret-hash.ts";

export type BaseSessionContext<OrganizationId extends string, UserId extends string> = {
  sessionId: SessionId.SessionId;
  organizationId: OrganizationId;
  userId: UserId;
  createdAt: DateTime.DateTime;
  expiresAt: DateTime.DateTime;
};

export interface BaseSessionContextWithToken<
  OrganizationId extends string,
  UserId extends string,
> extends BaseSessionContext<OrganizationId, UserId> {
  sessionToken: SessionToken.SessionToken;
}

/**
 * 簡易的なSessionManager
 */
export interface LouisSessionManager<OrganizationId extends string, UserId extends string> {
  /**
   * 新しいセッションを作成する
   * @param context 必須情報 (userId, organizationId)
   */
  createSession(
    organizationId: OrganizationId,
    userId: UserId,
  ): Effect.Effect<BaseSessionContextWithToken<OrganizationId, UserId>, UnknownRepositoryError>;

  /**
   * セッションIDから有効なセッションを取得・検証する
   * 延長なども勝手に行う。
   * @param sessionId セッションID
   */
  useSession(
    sessionToken: SessionToken.SessionToken,
    organizationId: OrganizationId,
  ): Effect.Effect<
    Option.Option<BaseSessionContext<OrganizationId, UserId>>,
    InvalidSessionTokenError | UnknownRepositoryError | InternalError
  >;

  /**
   * セッションを無効化する（ログアウトなど）
   */
  revokeSession(
    sessionToken: SessionToken.SessionToken,
  ): Effect.Effect<void, InvalidSessionTokenError | UnknownRepositoryError>;
}

// type Make = <OrganizationId extends string, UserId extends string>(options?: {
//   sessionRefreshDuration?: Duration.Duration;
//   sessionExpireDuration?: Duration.Duration;
// }) => Effect.Effect<
//   LouisSessionManager<OrganizationId, UserId>,
//   never,
//   SessionRepository
// >;

/**
 * LouisSessionManagerを生成する
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
  const sessionRepository = yield* SessionRepository;

  return {
    createSession: Effect.fn(function* (organizationId: OrganizationId, userId: UserId) {
      const sessionId = SessionId.generate();
      const sessionSecret = SessionSecret.generate();
      const sessionToken = SessionToken.createFrom(sessionId, sessionSecret);
      const now = yield* DateTime.now;
      const expiresAt = now.pipe(DateTime.addDuration(sessionExpireDuration));
      const nextVerifiedAt = now.pipe(DateTime.addDuration(sessionRefreshDuration));

      yield* sessionRepository.setSession(
        sessionId,
        sessionSecret,
        organizationId,
        userId,
        now,
        expiresAt,
        nextVerifiedAt,
      );

      return {
        sessionId,
        organizationId,
        userId,
        createdAt: now,
        expiresAt,
        sessionToken,
      };
    }),

    useSession: Effect.fn(function* (
      sessionToken: SessionToken.SessionToken,
      organizationId: OrganizationId,
    ) {
      const incomingSession = yield* parseSessionToken(sessionToken);

      const sessionOption = yield* sessionRepository.getSessionAndUser(incomingSession.sessionId);

      if (Option.isNone(sessionOption)) return Option.none();
      const databaseSession = sessionOption.value;

      // Organization IDが一致しない場合は削除する
      if (databaseSession.organizationId !== organizationId) {
        // 絶対に一致しないとおかしいので削除する
        yield* sessionRepository.deleteSession(databaseSession.id);
        return Option.none();
      }

      const incomingSecretHashHex = yield* hash(incomingSession.sessionSecret).pipe(
        InternalError.from((error) => error.message),
      );

      const incomingSecretHash = yield* decodeHex(incomingSecretHashHex).pipe(
        InternalError.from(
          (error) => (error as { message: string }).message ?? "Invalid hex string",
        ),
      );

      // Secret Hashが一致しない場合は削除する
      // databaseSession.secretHash is Uint8Array
      if (!constantTimeEqual(databaseSession.secretHash, incomingSecretHash)) {
        yield* sessionRepository.deleteSession(databaseSession.id);
        return yield* new InvalidSessionTokenError({
          message: "Session secret unmatched",
        });
      }

      // 有効期限切れ
      if (yield* DateTime.isPast(databaseSession.expiresAt)) {
        yield* sessionRepository.deleteSession(databaseSession.id);

        return Option.none();
      }

      // 次回検証日時が過ぎている場合は更新する
      if (yield* DateTime.isPast(databaseSession.nextVerifiedAt)) {
        const now = yield* DateTime.now;
        const nextVerifiedAt = now.pipe(DateTime.addDuration(sessionRefreshDuration));
        const expiresAt = now.pipe(DateTime.addDuration(sessionExpireDuration));

        yield* sessionRepository.updateSession(databaseSession.id, {
          nextVerifiedAt,
          expiresAt,
        });
      }

      return Option.some({
        sessionId: databaseSession.id,
        userId: databaseSession.userId,
        organizationId: databaseSession.organizationId,
        createdAt: databaseSession.createdAt,
        expiresAt: databaseSession.expiresAt,
      });
    }),
    revokeSession: Effect.fn(function* (sessionToken: SessionToken.SessionToken) {
      const incomingSession = yield* parseSessionToken(sessionToken);

      yield* sessionRepository.deleteSession(incomingSession.sessionId);
    }),
  } satisfies LouisSessionManager<OrganizationId, UserId>;
});
