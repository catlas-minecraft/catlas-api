import { sha256 } from "@oslojs/crypto/sha2";
import { Effect, Either, ParseResult, Schema } from "effect";

import { decodeHex, encodeHex } from "effect/Encoding";
import type { SessionSecret } from "./mod.ts";
import { SessionSecretFromString } from "./session-secret.ts";

export const SessionSecretHashBrand = Symbol(
  "@baketsu/louis/model/session/value-object/session-secret-hash",
);

const SessionSecretHashLength = 32;

export const SessionSecretHash = Schema.String.pipe(
  Schema.brand(SessionSecretHashBrand),
  Schema.filter((str) => {
    const bytesEither = decodeHex(str);

    if (Either.isLeft(bytesEither)) {
      return new ParseResult.Type(Schema.String.ast, str, bytesEither.left.message);
    }

    const bytes = bytesEither.right;

    if (bytes.length !== SessionSecretHashLength) {
      return new ParseResult.Type(
        Schema.String.ast,
        str,
        `Expected ${SessionSecretHashLength} bytes, got ${bytes.length}`,
      );
    }

    return true;
  }),
);

export const SessionSecretHashFromString = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  SessionSecretHash,
  {
    strict: true,
    encode: (inputString: string) =>
      decodeHex(inputString).pipe(
        Effect.mapError(
          (error) =>
            new ParseResult.Type(Schema.Uint8ArrayFromSelf.ast, inputString, error.message),
        ),
        Effect.flatMap((bytes) =>
          bytes.length !== SessionSecretHashLength
            ? Effect.fail(
                new ParseResult.Type(
                  Schema.Uint8ArrayFromSelf.ast,
                  inputString,
                  `Expected ${SessionSecretHashLength} bytes, got ${bytes.length}`,
                ),
              )
            : Effect.succeed(bytes),
        ),
      ),

    decode: (domainBytes: Uint8Array) => ParseResult.succeed(encodeHex(domainBytes)),
  },
);

export type SessionSecretHash = Schema.Schema.Type<typeof SessionSecretHash>;

export const hash = (sessionSecret: SessionSecret.SessionSecret) =>
  Effect.gen(function* () {
    const bytes = yield* Schema.decode(SessionSecretFromString)(sessionSecret);

    return yield* Schema.decode(SessionSecretHashFromString)(sha256(bytes));
  });
