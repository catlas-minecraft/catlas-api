import { JoseJwtService } from "@catlas/louis/service/louis/jwt/implementations/jose-jwt-service";
import type { JwtLouisSessionManager } from "@catlas/louis/service/louis/jwt/jwt-louis-session-manager";
import { make as makeJwtLouisSessionManager } from "@catlas/louis/service/louis/jwt/jwt-louis-session-manager";
import { Config, Context, Duration, Layer, Redacted } from "effect";
import { SessionRepository } from "./KyselySessionRepository.js";

const jwtSecretConfig = Config.map(Config.redacted("JWT_SECRET"), (secret) =>
  Redacted.make(new TextEncoder().encode(Redacted.value(secret))),
);

export const JwtServiceLive = Layer.unwrapEffect(
  Config.map(jwtSecretConfig, (secret) =>
    JoseJwtService.layer({
      secret,
      defaultExpiration: Duration.minutes(5),
    }),
  ),
);

export class AuthSessionManager extends Context.Tag("@catlas/api/auth/AuthSessionManager")<
  AuthSessionManager,
  JwtLouisSessionManager<string>
>() {}

export const AuthSessionManagerLive = Layer.effect(
  AuthSessionManager,
  makeJwtLouisSessionManager({
    SessionRepository: SessionRepository,
  }),
);
