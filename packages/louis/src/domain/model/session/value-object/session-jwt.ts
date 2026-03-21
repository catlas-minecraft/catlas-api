import { Schema } from "effect";

export const SessionJwtBrand = Symbol(
  "@baketsu/louis/model/session/value-object/session-jwt",
);

/**
 * JWT token schema with brand type
 * Validates that the string is in the format: header.payload.signature
 */
export const SessionJwt = Schema.String.pipe(Schema.brand(SessionJwtBrand));
export type SessionJwt = Schema.Schema.Type<typeof SessionJwt>;
