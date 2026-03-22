import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Schema } from "effect"
import * as AuthSchema from "@catlas/schema/Auth"

export const UserId = AuthSchema.UserId
export type UserId = typeof AuthSchema.UserId.Type

export const SessionJwtToken = AuthSchema.SessionJwtToken
export type SessionJwtToken = typeof AuthSchema.SessionJwtToken.Type

export class AuthSession extends Schema.Class<AuthSession>("AuthSession")({
  sessionId: Schema.String,
  userId: UserId,
  createdAt: Schema.Number,
  expiresAt: Schema.Number,
  sessionJwt: SessionJwtToken
}) {}

export class VerifiedAuthSession extends Schema.Class<VerifiedAuthSession>("VerifiedAuthSession")({
  sessionId: Schema.String,
  userId: UserId,
  createdAt: Schema.Number,
  expiresAt: Schema.Number,
  refreshedSessionJwt: Schema.Union(SessionJwtToken, Schema.Null)
}) {}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()("UnauthorizedError", {
  message: Schema.String
}) {}

export class AuthOperationError extends Schema.TaggedError<AuthOperationError>()("AuthOperationError", {
  message: Schema.String
}) {}

export class AuthApiGroup extends HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("createSession", "/sessions")
      .addSuccess(AuthSession)
      .addError(AuthOperationError, { status: 500 })
      .setPayload(Schema.Struct({ userId: UserId }))
  )
  .add(
    HttpApiEndpoint.post("verifySession", "/sessions/verify")
      .addSuccess(VerifiedAuthSession)
      .addError(UnauthorizedError, { status: 401 })
      .addError(AuthOperationError, { status: 500 })
      .setPayload(Schema.Struct({ sessionJwt: SessionJwtToken }))
  )
  .add(
    HttpApiEndpoint.post("revokeSession", "/sessions/revoke")
      .addSuccess(Schema.Void)
      .addError(UnauthorizedError, { status: 401 })
      .addError(AuthOperationError, { status: 500 })
      .setPayload(Schema.Struct({ sessionJwt: SessionJwtToken }))
  )
  .prefix("/auth")
{}
