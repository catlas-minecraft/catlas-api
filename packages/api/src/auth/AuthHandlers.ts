import { AuthOperationError, UnauthorizedError } from "@catlas/domain/AuthApi"
import type { SessionJwt } from "@catlas/louis/domain/model/session/value-object/session-jwt"
import { AuthSessionManager, AuthSessionManagerLive } from "./AuthSessionManager.js"
import { DateTime, Effect, Layer, Option } from "effect"
import { HttpApiBuilder } from "@effect/platform"
import { Api } from "@catlas/domain/Api"

const toEpochMillis = (dateTime: DateTime.DateTime) => dateTime.pipe(DateTime.toEpochMillis)

const toAuthOperationError = (message: string) =>
  new AuthOperationError({ message })

const toUnauthorizedError = (message: string) =>
  new UnauthorizedError({ message })

const getErrorMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message?: unknown }
    if (typeof message === "string") {
      return message
    }
  }

  return "Auth operation failed"
}

const toLouisSessionJwt = (sessionJwt: string) => sessionJwt as SessionJwt

export const AuthApiLive = HttpApiBuilder.group(Api, "auth", (handlers) =>
  Effect.gen(function*() {
    const auth = yield* AuthSessionManager

    return handlers
      .handle("createSession", ({ payload: { userId } }) =>
        auth.createSessionAsJwt(userId).pipe(
          Effect.map(({ session, sessionJwt }) => ({
            sessionId: session.sessionId,
            userId: session.userId,
            createdAt: toEpochMillis(session.createdAt),
            expiresAt: toEpochMillis(session.expiresAt),
            sessionJwt: sessionJwt.value
          })),
          Effect.mapError((error) => toAuthOperationError(getErrorMessage(error)))
        )
      )
      .handle("verifySession", ({ payload: { sessionJwt } }) =>
        auth.useSessionWithJwt(toLouisSessionJwt(sessionJwt)).pipe(
          Effect.flatMap((sessionResult) =>
            Option.isNone(sessionResult)
              ? Effect.fail(toUnauthorizedError("Session not found or expired"))
              : Effect.succeed({
                  sessionId: sessionResult.value.session.sessionId,
                  userId: sessionResult.value.session.userId,
                  createdAt: toEpochMillis(sessionResult.value.session.createdAt),
                  expiresAt: toEpochMillis(sessionResult.value.session.expiresAt),
                  refreshedSessionJwt: Option.isNone(sessionResult.value.sessionJwt)
                    ? null
                    : sessionResult.value.sessionJwt.value
                })
          ),
          Effect.mapError((error) => {
            switch (error._tag) {
              case "InvalidSessionTokenError":
              case "JwtInvalidError":
              case "JwtVerifyError":
                return toUnauthorizedError(getErrorMessage(error))
              case "UnauthorizedError":
                return error
              default:
                return toAuthOperationError(getErrorMessage(error))
            }
          })
        )
      )
      .handle("revokeSession", ({ payload: { sessionJwt } }) =>
        auth.revokeSessionWithJwt(toLouisSessionJwt(sessionJwt)).pipe(
          Effect.mapError((error) => {
            switch (error._tag) {
              case "InvalidSessionTokenError":
              case "JwtInvalidError":
                return toUnauthorizedError(getErrorMessage(error))
              default:
                return toAuthOperationError(getErrorMessage(error))
            }
          })
        )
      )
  }))

export const AuthLive = Layer.provide(AuthApiLive, AuthSessionManagerLive)
