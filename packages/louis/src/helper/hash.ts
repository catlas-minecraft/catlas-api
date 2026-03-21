import { Data, Effect } from "effect";

export class CryptoDigestError extends Data.TaggedError("CryptoDigestError")<{
  readonly cause: unknown;
}> {}

export const hashString = (
  str: string,
): Effect.Effect<Uint8Array, CryptoDigestError> =>
  Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)),
    catch: (cause) => new CryptoDigestError({ cause }),
  }).pipe(Effect.map((buffer) => new Uint8Array(buffer)));
