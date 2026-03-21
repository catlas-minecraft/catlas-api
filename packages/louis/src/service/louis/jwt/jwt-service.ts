import { Context, Data, type Effect } from "effect";
import type { SessionJwt } from "../../../domain/model/session/value-object/session-jwt.ts";
import type { SessionToken } from "../../../domain/model/session/value-object/mod.ts";

export class JwtSignError extends Data.TaggedError("JwtSignError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class JwtVerifyError extends Data.TaggedError("JwtVerifyError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class JwtInvalidError extends Data.TaggedError("JwtInvalidError")<{
  readonly message: string;
}> {}

export class JwtExpiredError extends Data.TaggedError("JwtExpiredError")<{
  readonly expiredAt: number;
}> {}

export type JwtPayload = {
  stk: SessionToken.SessionToken;
  oid: string;
  uid: string;
  exp?: number;
  iat?: number;
};

export interface JwtServiceInterface {
  readonly sign: (payload: JwtPayload) => Effect.Effect<SessionJwt, JwtSignError>;
  readonly verify: (
    jwt: SessionJwt,
  ) => Effect.Effect<JwtPayload, JwtVerifyError | JwtExpiredError | JwtInvalidError>;
  readonly unsafeDecode: (jwt: SessionJwt) => Effect.Effect<JwtPayload, JwtInvalidError>;
}

export class JwtService extends Context.Tag("@louis/service/JwtService")<
  JwtService,
  JwtServiceInterface
>() {}
