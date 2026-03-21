import { Data, Effect, ParseResult, Schema } from "effect";

import { SessionSecret, SessionId } from "./mod.ts";
import { InvalidSessionTokenError } from "../../../error.ts";

const SessionTokenBrand = Symbol("SessionTokenBrand");
export const SessionToken = Schema.String.pipe(Schema.brand(SessionTokenBrand));
export type SessionToken = Schema.Schema.Type<typeof SessionToken>;

/**
 * Generate a session token from a session ID and a session secret
 */
export const generate = () => {
  const sessionId = SessionId.generate();
  const sessionSecret = SessionSecret.generate();

  return `${sessionId}.${sessionSecret}` as SessionToken;
};

export const createFrom = (
  sessionId: SessionId.SessionId,
  sessionSecret: SessionSecret.SessionSecret,
) => {
  return `${sessionId}.${sessionSecret}` as SessionToken;
};

export const parseSessionToken = Effect.fn(function* (token: SessionToken) {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return yield* new InvalidSessionTokenError({ message: "Invalid format" });
  }

  const [id, rawSecret] = parts;

  const sessionId = yield* Schema.decodeEither(SessionId.SessionId)(id).pipe(
    Effect.mapError(
      (error) =>
        new InvalidSessionTokenError({
          message: error.message,
        }),
    ),
  );
  const sessionSecret = yield* Schema.decode(SessionSecret.SessionSecret)(
    rawSecret,
  ).pipe(
    Effect.mapError(
      (error) =>
        new InvalidSessionTokenError({
          message: error.message,
        }),
    ),
  );

  return { sessionId, sessionSecret } as const;
});

export const getId = (token: SessionToken): SessionId.SessionId => {
  const [id] = token.split(".");
  return Schema.decodeSync(SessionId.SessionId)(id);
};
