---
name: effect-ts
description: Guidance for implementing Effect TS code. Use when adding or reviewing Effect-based services, Layers, HttpApi clients, or HTTP integrations. Prefer @effect/platform HttpClient and HttpApiClient over raw fetch, keep I/O inside Effect, and map failures to typed errors.
---

# Effect TS

Use this skill when work involves Effect TS application code. The current focus is HTTP access and client wiring, starting from one rule: prefer `@effect/platform` `HttpClient` / `HttpApiClient` over raw `fetch`.

## Core Rules

1. Keep external I/O inside `Effect`. Do not wrap ad-hoc `fetch` calls with `Effect.tryPromise` unless a third-party library forces it.
2. For typed APIs defined with `HttpApi`, prefer `HttpApiClient.make(...)` and provide the transport layer once at the boundary.
3. For non-`HttpApi` outbound calls, start from `@effect/platform` `HttpClient` and related request/response modules instead of raw `fetch`.
4. Inject clients through `Layer` and `Context.Tag` rather than constructing them at every call site.
5. Convert transport failures into typed application or domain errors before returning from a use case.

## Decision Guide

- Calling a typed backend API from the client app:
  Use `HttpApiClient.make(...)` with the `HttpApi` contract and provide `FetchHttpClient.layer` as transport.
- Adding another browser or server-side HTTP integration:
  Start from a shared `HttpClient`-based service and provide the runtime-specific transport layer at composition time.
- Reaching for `fetch` because it looks smaller:
  Stop and check whether `HttpClient` or `HttpApiClient` covers the case first. Following Effect patterns should be the default path.
- Acceptable exceptions:
  Third-party libraries that only expose `fetch` hooks, browser APIs that require native `Request` / `Response`, or isolated code where Effect layers cannot reasonably be introduced. Call the exception out in code comments or review notes.

## Implementation Pattern

Use this as the baseline shape for typed clients:

```ts
const makeApiClient = () =>
  HttpApiClient.make(PublicApi, {
    baseUrl
  }).pipe(Effect.provide(FetchHttpClient.layer))
```

Then expose the client through `Context.Tag`, build a `Layer`, and let callers depend on the service instead of a global singleton.

## Review Checklist

- Does new HTTP code rely on `@effect/platform` primitives instead of raw `fetch`?
- Is the transport layer provided once near client construction rather than inside every use case?
- Are base URLs, headers, retries, and timeouts attached near the client boundary?
- Are errors typed and mapped before crossing the application boundary?
- Is there an existing shared client module to extend instead of adding another ad-hoc helper?

## References

- For concrete HTTP guidance and refactor notes, read [references/http-client.md](./references/http-client.md) when the task involves outbound HTTP.
