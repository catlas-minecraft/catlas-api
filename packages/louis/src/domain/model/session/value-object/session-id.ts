import { Schema } from "effect";
import { generateSecureRandomString } from "../../../../helper/generateSecureRandomString.ts";

export const SessionIdBrand = Symbol("@baketsu/louis/model/session/value-object/session-id");

export const SessionId = Schema.String.pipe(Schema.brand(SessionIdBrand));
export type SessionId = Schema.Schema.Type<typeof SessionId>;

export const generate = () => {
  const randomId = generateSecureRandomString();

  return Schema.decodeSync(SessionId)(randomId);
};
