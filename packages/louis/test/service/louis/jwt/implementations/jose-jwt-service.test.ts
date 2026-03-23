import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, Layer, Logger, Redacted, TestClock } from "effect";
import * as joseJwtService from "../../../../../src/service/louis/jwt/implementations/jose-jwt-service.js";
import { JwtExpiredError, JwtService } from "../../../../../src/service/louis/jwt/jwt-service.js";
import { SessionToken } from "../../../../../src/domain/model/session/value-object/mod.js";

const JWT_DEFAULT_EXPIRATION = Duration.minutes(5);
const JWT_DEFAULT_EXPIRED_DURATION = Duration.minutes(10);

const provideServices = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, JwtService>> => {
  const jwtService = joseJwtService.layer({
    secret: Redacted.make(new Uint8Array(32)),
    defaultExpiration: JWT_DEFAULT_EXPIRATION,
  });

  return effect.pipe(Effect.provide(Layer.merge(jwtService, Logger.pretty)));
};

describe("Jose JWT Service", () => {
  it.effect("normal use", () =>
    Effect.gen(function* () {
      const jwtService = yield* JwtService;

      const payload = {
        stk: "session-token" as SessionToken.SessionToken,
        uid: "user-id",
      };

      const jwt = yield* jwtService.sign(payload);

      const verifiedPayload = yield* jwtService.verify(jwt);

      expect(verifiedPayload).toEqual(expect.objectContaining(payload));
    }).pipe(provideServices),
  );

  it.effect("expired token", () =>
    Effect.gen(function* () {
      const jwtService = yield* JwtService;

      const payload = {
        stk: "session-token" as SessionToken.SessionToken,
        uid: "user-id",
      };

      const jwt = yield* jwtService.sign(payload);

      yield* TestClock.adjust(JWT_DEFAULT_EXPIRED_DURATION);

      const result = yield* Effect.exit(jwtService.verify(jwt));

      expect(result).toStrictEqual(Exit.fail(new JwtExpiredError({ expiredAt: 0 })));
    }).pipe(provideServices),
  );
});
