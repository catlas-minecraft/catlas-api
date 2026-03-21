import { Effect, Either, ParseResult, Schema } from "effect";

import { decodeHex, encodeHex } from "effect/Encoding";

export const SessionSecretBrand = Symbol(
  "@baketsu/louis/model/session/value-object/session-secret",
);

export const SessionSecret = Schema.String.pipe(
  Schema.brand(SessionSecretBrand),
  Schema.filter((str) => {
    const bytesEither = decodeHex(str);

    if (Either.isLeft(bytesEither)) {
      return new ParseResult.Type(
        Schema.String.ast,
        str,
        bytesEither.left.message,
      );
    }

    const bytes = bytesEither.right;
    return bytes.length === 24 || "Invalid length";
  }),
);

export const SessionSecretFromString = Schema.transformOrFail(
  Schema.String,
  Schema.Uint8ArrayFromSelf,
  {
    strict: true,
    decode: (inputString: string) =>
      decodeHex(inputString).pipe(
        Effect.mapError(
          (error) =>
            new ParseResult.Type(
              Schema.Uint8ArrayFromSelf.ast,
              inputString,
              error.message,
            ),
        ),
        Effect.flatMap((bytes) =>
          bytes.length !== 24
            ? Effect.fail(
                new ParseResult.Type(
                  Schema.Uint8ArrayFromSelf.ast,
                  inputString,
                  "Invalid length",
                ),
              )
            : Effect.succeed(bytes),
        ),
      ),

    encode: (domainBytes: Uint8Array) =>
      ParseResult.succeed(encodeHex(domainBytes)),
  },
);

export type SessionSecret = Schema.Schema.Type<typeof SessionSecret>;

export const generate = (): SessionSecret => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);

  return encodeHex(bytes) as SessionSecret;
};
