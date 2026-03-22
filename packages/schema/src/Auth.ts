import { Schema } from "effect"

export const UserId = Schema.NonEmptyTrimmedString.annotations({
  title: "UserId",
  description: "Authenticated user identifier"
})
export type UserId = typeof UserId.Type

export const SessionJwtToken = Schema.String.annotations({
  title: "SessionJwtToken",
  description: "JWT string used for session authentication"
})
export type SessionJwtToken = typeof SessionJwtToken.Type
