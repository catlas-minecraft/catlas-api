import type { DateTime, Effect, Option } from "effect";
import type { SessionId, SessionSecret } from "./model/session/value-object/mod.ts";
import type { UnknownRepositoryError } from "./repository-errors.js";

export interface DatabaseSession<OrganizationId extends string, UserId extends string> {
  id: SessionId.SessionId;
  secretHash: Uint8Array;
  userId: UserId;
  organizationId: OrganizationId;
  expiresAt: DateTime.DateTime;
  nextVerifiedAt: DateTime.DateTime;
  createdAt: DateTime.DateTime;
}

export interface SessionRepositoryInterface<OrganizationId extends string, UserId extends string> {
  getSessionAndUser(
    sessionId: SessionId.SessionId,
  ): Effect.Effect<Option.Option<DatabaseSession<OrganizationId, UserId>>, UnknownRepositoryError>;

  getUserSessions(
    userId: UserId,
    organizationId: OrganizationId,
  ): Effect.Effect<DatabaseSession<OrganizationId, UserId>[], UnknownRepositoryError>;

  setSession(
    id: SessionId.SessionId,
    secret: SessionSecret.SessionSecret,
    organizationId: OrganizationId,
    userId: UserId,
    createdAt: DateTime.DateTime,
    expiresAt: DateTime.DateTime,
    nextVerifiedAt: DateTime.DateTime,
  ): Effect.Effect<void, UnknownRepositoryError>;

  updateSession(
    sessionId: SessionId.SessionId,
    data: {
      expiresAt: DateTime.DateTime;
      nextVerifiedAt: DateTime.DateTime;
    },
  ): Effect.Effect<void, UnknownRepositoryError>;

  deleteSession(sessionId: SessionId.SessionId): Effect.Effect<void, UnknownRepositoryError>;

  deleteUserSessions(
    userId: UserId,
    organizationId: OrganizationId,
  ): Effect.Effect<void, UnknownRepositoryError>;

  deleteExpiredSessions(): Effect.Effect<void, UnknownRepositoryError>;
}

// export class SessionRepository extends Context.Tag("SessionRepositoryContext")<
//   SessionRepository,
//   SessionRepositoryInterface
// >() {}
