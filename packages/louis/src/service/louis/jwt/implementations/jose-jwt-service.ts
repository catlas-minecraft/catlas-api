import { DateTime, type Duration, Effect, Layer, Redacted } from "effect";
import * as Jose from "jose";
import type { SessionJwt } from "../../../../domain/model/session/value-object/session-jwt.ts";
import {
  JwtExpiredError,
  JwtInvalidError,
  type JwtPayload,
  JwtService,
  type JwtServiceInterface,
  JwtSignError,
  JwtVerifyError,
} from "../jwt-service.js";
import { dateTime2Epoch } from "../../../../utils.js";

const make = (params: {
  secret: Redacted.Redacted<Uint8Array>;
  defaultExpiration?: Duration.Duration;
}) => {
  const secretKey = Redacted.value(params.secret);

  const sign: JwtServiceInterface["sign"] = Effect.fn(function* (payload) {
    const now = yield* DateTime.now;

    return yield* Effect.tryPromise({
      try: async () => {
        const builder = new Jose.SignJWT(payload)
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt(now.pipe(dateTime2Epoch));

        if (params.defaultExpiration) {
          const expirationTime = now.pipe(
            DateTime.addDuration(params.defaultExpiration),
            dateTime2Epoch,
          );
          builder.setExpirationTime(expirationTime);
        }

        return await builder.sign(secretKey);
      },
      catch: (error) =>
        new JwtSignError({
          message: "Failed to sign JWT",
          cause: error,
        }),
    }).pipe(Effect.map((token) => token as SessionJwt));
  });

  const verify: JwtServiceInterface["verify"] = Effect.fn(function* (jwt) {
    const currentDate = yield* DateTime.nowAsDate;

    return yield* Effect.tryPromise({
      try: async () => {
        const { payload } = await Jose.jwtVerify(jwt, secretKey, {
          currentDate,
        });
        return payload as JwtPayload;
      },
      catch: (error) => {
        if (error instanceof Jose.errors.JWTExpired) {
          return new JwtExpiredError({
            expiredAt: error.claim === "exp" ? 0 : 0,
            cause: error,
          });
        }
        if (
          error instanceof Jose.errors.JWTInvalid ||
          error instanceof Jose.errors.JWSSignatureVerificationFailed
        ) {
          return new JwtInvalidError({ message: error.message });
        }
        return new JwtVerifyError({
          message: "Failed to verify JWT",
          cause: error,
        });
      },
    });
  });

  const unsafeDecode: JwtServiceInterface["unsafeDecode"] = (jwt) =>
    Effect.try({
      try: () => Jose.decodeJwt(jwt) as JwtPayload,
      catch: (error) =>
        new JwtInvalidError({
          message: error instanceof Error ? error.message : "Failed to decode JWT",
        }),
    });

  return {
    sign,
    verify,
    unsafeDecode,
  };
};

export const layer = (params: {
  secret: Redacted.Redacted<Uint8Array>;
  defaultExpiration?: Duration.Duration;
}) => Layer.succeed(JwtService, make(params));

export const JoseJwtService = {
  make,
  layer,
};
