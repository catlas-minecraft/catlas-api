import { UnauthorizedError } from "@catlas/domain/AuthApi";
import { CurrentActor, WriteAuthorization } from "@catlas/domain/GeospatialApi";
import type { SessionJwt } from "@catlas/louis/domain/model/session/value-object/session-jwt";
import { Effect, Layer, Option, Redacted } from "effect";
import { AuthSessionManager } from "./AuthSessionManager.js";

const toLouisSessionJwt = (sessionJwt: string) => sessionJwt as SessionJwt;

export const WriteAuthorizationLive = Layer.effect(
  WriteAuthorization,
  Effect.gen(function* () {
    const auth = yield* AuthSessionManager;

    const verifySessionJwt = (sessionJwt: Redacted.Redacted<string>) => {
      const token = Redacted.value(sessionJwt).trim();

      if (token.length === 0) {
        return Effect.fail(new UnauthorizedError({ message: "Authentication required" }));
      }

      return auth.useSessionWithJwt(toLouisSessionJwt(token)).pipe(
        Effect.orElseFail(() => new UnauthorizedError({ message: "Invalid session token" })),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(new UnauthorizedError({ message: "Session not found or expired" })),
            onSome: ({ session }) => Effect.succeed(CurrentActor.of({ actorId: session.userId })),
          }),
        ),
      );
    };

    return {
      bearer: verifySessionJwt,
      sessionCookie: verifySessionJwt,
    };
  }),
);
