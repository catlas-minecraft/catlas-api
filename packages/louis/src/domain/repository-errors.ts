import { Data } from "effect";
import type { SessionId } from "./model/session/value-object/mod.ts";

/**
 * Error thrown when a session is not found in the repository
 */
export class SessionNotFoundError extends Data.TaggedError("SessionNotFoundError")<{
  readonly sessionId: SessionId.SessionId;
}> {}

/**
 * Error thrown when a session update operation fails
 * (e.g., no rows were affected by the update)
 */
export class SessionUpdateFailedError extends Data.TaggedError("SessionUpdateFailedError")<{
  readonly sessionId: SessionId.SessionId;
  readonly reason?: string;
}> {}

/**
 * Error thrown when a session delete operation fails
 * (e.g., no rows were affected by the delete)
 */
export class SessionDeleteFailedError extends Data.TaggedError("SessionDeleteFailedError")<{
  readonly sessionId: SessionId.SessionId;
  readonly reason?: string;
}> {}

/**
 * Error thrown when an unknown repository error occurs
 */
export class UnknownRepositoryError extends Data.TaggedError("UnknownRepositoryError")<{
  readonly cause?: unknown;
  readonly message?: string;
}> {}
