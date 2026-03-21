import { Schema as EffectSchema } from "effect";

export const UserIdBrand = Symbol(
  "@baketsu/louis/model/user/value-object/user-id",
);

export const Schema = EffectSchema.Union(
  EffectSchema.String,
  EffectSchema.Number,
).pipe(EffectSchema.brand(UserIdBrand));

export type Type = EffectSchema.Schema.Type<typeof Schema>;
