# HttpClient Notes

Read this file when implementing a new outbound HTTP call or refactoring raw `fetch` usage into Effect-native code.

## Preferred Order

1. If the target API is already described with `HttpApi`, use `HttpApiClient`.
2. If no typed `HttpApi` contract exists, use `HttpClient` and related request/response helpers from `@effect/platform`.
3. Only fall back to raw `fetch` when a platform or third-party integration makes `HttpClient` impractical.

## Implementation Pattern

A well-structured HTTP client follows this pattern:

```ts
const makeApiClient = () =>
  HttpApiClient.make(PublicApi, {
    baseUrl
  }).pipe(Effect.provide(FetchHttpClient.layer))

export class ApiClient extends Context.Tag("ApiClient")<
  ApiClient,
  PublicApiClient
>() {}

const ApiClientLive = Layer.effect(ApiClient, makeApiClient())
```

Key rules of thumb:

- build the client once
- provide transport once
- expose the client as a service
- let callers consume it through the Effect runtime

## Refactor Approach

When you find raw `fetch` usage:

1. Move base URL, headers, and transport setup into a dedicated client module.
2. Replace Promise-returning helpers with `Effect`-returning helpers.
3. Inject the client through `Layer` / `Context.Tag`.
4. Map transport failures into typed errors close to the client boundary.
5. Keep parsing and validation explicit before data enters domain code.

## Avoid

- Creating HTTP clients inside React render paths or per-request business logic.
- Hiding native `fetch` inside `Effect.tryPromise` without a clear integration reason.
- Returning unvalidated `unknown` JSON deep into application code.
- Mixing thrown exceptions and typed Effect errors in the same client path.
