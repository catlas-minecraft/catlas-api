import { Data, Effect } from "effect";

export class InvalidSessionTokenError extends Data.TaggedError(
  "InvalidSessionTokenError",
)<{
  readonly message: string;
}> {}

export class InternalError extends Data.TaggedError("InternalError")<{
  message: string;
}> {
  static from<E>(handler: (error: E) => string) {
    return <A, R>(effect: Effect.Effect<A, E, R>) => {
      return Effect.mapError(
        effect,
        (error) => new InternalError({ message: handler(error) }),
      );
    };
  }
}
