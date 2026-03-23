import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, Layer, Logger, Redacted, TestClock } from "effect";
import * as joseJwtService from "../../../../../src/service/louis/jwt/implementations/jose-jwt-service.js";
import {
  JwtExpiredError,
  JwtInvalidError,
  JwtService,
} from "../../../../../src/service/louis/jwt/jwt-service.js";
import type { SessionJwt } from "../../../../../src/domain/model/session/value-object/session-jwt.js";
import { SessionToken } from "../../../../../src/domain/model/session/value-object/mod.js";

const JWT_DEFAULT_EXPIRATION = Duration.minutes(5);
const JWT_DEFAULT_EXPIRED_DURATION = Duration.minutes(10);
const PRIMARY_SECRET = Redacted.make(new Uint8Array(32));
const SECONDARY_SECRET = Redacted.make(new Uint8Array(Array.from({ length: 32 }, () => 1)));

const provideServices = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, JwtService>> => {
  const jwtService = joseJwtService.layer({
    secret: PRIMARY_SECRET,
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
      expect(verifiedPayload.iat).toEqual(expect.any(Number));
      expect(verifiedPayload.exp).toEqual(expect.any(Number));
      expect(verifiedPayload.exp).toBeGreaterThan(verifiedPayload.iat ?? 0);
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

      expect(result).toMatchObject(
        Exit.fail(
          expect.objectContaining<Partial<JwtExpiredError>>({
            _tag: "JwtExpiredError",
            expiredAt: 0,
          }),
        ),
      );
    }).pipe(provideServices),
  );

  it.effect("invalid signature", () =>
    Effect.gen(function* () {
      const signService = joseJwtService.JoseJwtService.make({
        secret: PRIMARY_SECRET,
        defaultExpiration: JWT_DEFAULT_EXPIRATION,
      });
      const verifyService = joseJwtService.JoseJwtService.make({
        secret: SECONDARY_SECRET,
        defaultExpiration: JWT_DEFAULT_EXPIRATION,
      });

      const jwt = yield* signService.sign({
        stk: "session-token" as SessionToken.SessionToken,
        uid: "user-id",
      });

      const result = yield* Effect.exit(verifyService.verify(jwt));

      expect(result).toMatchObject(
        Exit.fail(
          expect.objectContaining<Partial<JwtInvalidError>>({
            _tag: "JwtInvalidError",
          }),
        ),
      );
    }).pipe(provideServices),
  );

  it.effect("unsafe decode rejects malformed token", () =>
    Effect.gen(function* () {
      const jwtService = yield* JwtService;

      const result = yield* Effect.exit(jwtService.unsafeDecode("not-a-jwt" as SessionJwt));

      expect(result).toMatchObject(
        Exit.fail(
          expect.objectContaining<Partial<JwtInvalidError>>({
            _tag: "JwtInvalidError",
          }),
        ),
      );
    }).pipe(provideServices),
  );
});
