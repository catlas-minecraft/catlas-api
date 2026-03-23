import { type Context, DateTime, Duration, Effect, Option } from "effect";
import type { SessionRepositoryInterface } from "../../domain/repository.ts";
import { constantTimeEqual } from "@oslojs/crypto/subtle";
import { decodeHex } from "effect/Encoding";
import {
  SessionId,
  SessionSecret,
  SessionToken,
} from "../../domain/model/session/value-object/mod.js";
import type { UnknownRepositoryError } from "../../domain/repository-errors.js";
import { parseSessionToken } from "../../domain/model/session/value-object/session-token.js";
import { InternalError, InvalidSessionTokenError } from "../../domain/error.js";
import { hash } from "../../domain/model/session/value-object/session-secret-hash.js";

export type BaseSessionContext<UserId extends string> = {
  sessionId: SessionId.SessionId;
  userId: UserId;
  createdAt: DateTime.DateTime;
  expiresAt: DateTime.DateTime;
};

export interface BaseSessionContextWithToken<
  UserId extends string,
> extends BaseSessionContext<UserId> {
  sessionToken: SessionToken.SessionToken;
}

/**
 * 簡易的なSessionManager
 */
export interface LouisSessionManager<UserId extends string> {
  /**
   * 新しいセッションを作成する
   * @param context 必須情報 (userId)
   */
  createSession(
    userId: UserId,
  ): Effect.Effect<BaseSessionContextWithToken<UserId>, UnknownRepositoryError>;

  /**
   * セッションIDから有効なセッションを取得・検証する
   * 延長なども勝手に行う。
   * @param sessionId セッションID
   */
  useSession(
    sessionToken: SessionToken.SessionToken,
  ): Effect.Effect<
    Option.Option<BaseSessionContext<UserId>>,
    InvalidSessionTokenError | UnknownRepositoryError | InternalError
  >;

  /**
   * セッションを無効化する（ログアウトなど）
   */
  revokeSession(
    sessionToken: SessionToken.SessionToken,
  ): Effect.Effect<void, InvalidSessionTokenError | UnknownRepositoryError>;
}

export type Make = <
  UserId extends string,
  SessionRepositoryId,
  SessionRepositoryService extends SessionRepositoryInterface<UserId> =
    SessionRepositoryInterface<UserId>,
>(options: {
  sessionRefreshDuration?: Duration.Duration | undefined;
  sessionExpireDuration?: Duration.Duration | undefined;
  SessionRepository: Context.Tag<SessionRepositoryId, SessionRepositoryService>;
}) => Effect.Effect<LouisSessionManager<UserId>, never, SessionRepositoryId>;

/**
 * LouisSessionManagerを生成する
 */
export const make: Make = <
  UserId extends string,
  SessionRepositoryId,
  SessionRepositoryService extends SessionRepositoryInterface<UserId> =
    SessionRepositoryInterface<UserId>,
>({
  sessionRefreshDuration = Duration.hours(1),
  sessionExpireDuration = Duration.weeks(1),
  SessionRepository,
}: {
  sessionRefreshDuration?: Duration.Duration | undefined;
  sessionExpireDuration?: Duration.Duration | undefined;
  SessionRepository: Context.Tag<SessionRepositoryId, SessionRepositoryService>;
}) =>
  Effect.gen(function* () {
    const sessionRepository = yield* SessionRepository;

    const createSession: LouisSessionManager<UserId>["createSession"] = Effect.fn(
      "LouisSessionManager.createSession",
    )(function* (userId) {
      const sessionId = SessionId.generate();
      const sessionSecret = SessionSecret.generate();
      const sessionToken = SessionToken.createFrom(sessionId, sessionSecret);
      const now = yield* DateTime.now;
      const expiresAt = now.pipe(DateTime.addDuration(sessionExpireDuration));
      const nextVerifiedAt = now.pipe(DateTime.addDuration(sessionRefreshDuration));

      yield* sessionRepository.setSession(
        sessionId,
        sessionSecret,
        userId,
        now,
        expiresAt,
        nextVerifiedAt,
      );

      return {
        sessionId,
        userId,
        createdAt: now,
        expiresAt,
        sessionToken,
      } satisfies BaseSessionContextWithToken<UserId>;
    });

    const useSession: LouisSessionManager<UserId>["useSession"] = Effect.fn(
      "LouisSessionManager.useSession",
    )(function* (sessionToken) {
      const incomingSession = yield* parseSessionToken(sessionToken);

      const sessionOption = yield* sessionRepository.getSessionAndUser(incomingSession.sessionId);

      if (Option.isNone(sessionOption)) return Option.none();
      const databaseSession = sessionOption.value;

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
        createdAt: databaseSession.createdAt,
        expiresAt: databaseSession.expiresAt,
      });
    });

    const revokeSession: LouisSessionManager<UserId>["revokeSession"] = Effect.fn(
      "LouisSessionManager.revokeSession",
    )(function* (sessionToken) {
      const incomingSession = yield* parseSessionToken(sessionToken);

      yield* sessionRepository.deleteSession(incomingSession.sessionId);
    });

    return {
      createSession,
      useSession,
      revokeSession,
    } satisfies LouisSessionManager<UserId>;
  });
