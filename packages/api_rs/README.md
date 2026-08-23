# Catlas API (Rust)

## Local development

Enter the Nix development shell and install workspace dependencies:

```sh
direnv allow
vp install
```

Create the local environment file from `.env.example`, then start PostGIS and apply migrations:

```sh
vp run -w db:up
vp run -w db:migrate
vp run -w db:schema
```

The `db:up` command also starts Jaeger with its local OTLP receiver. Open the
Jaeger UI at `http://127.0.0.1:16686`. The Rust API exports traces to
`http://127.0.0.1:4318/v1/traces` when `OTEL_ENABLED=true`.

Start the API on `http://127.0.0.1:3000`:

```sh
cargo run -p catlas-api
```

`HOST` and `PORT` override the defaults (`127.0.0.1` and `3000`). The HTTP API is
under `/api`; interactive Scalar documentation is at `/docs` and the OpenAPI
document is `/api/openapi.json`. Sessions use an HttpOnly, SameSite=Lax cookie
and the in-memory Poem session store. Configure generic OpenID Connect with
`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and
`OIDC_REDIRECT_URI`; `OIDC_AUDIENCE`, `OIDC_POST_LOGIN_REDIRECT_URI`, and
`OIDC_SCOPES` are optional. Set `OIDC_AUDIENCE` when the ID token contains an
additional trusted audience besides the client ID. The provider must redirect to `/api/auth/oidc/callback`. `GET
/api/auth/oidc/login` starts login, and the callback stores only the internal user ID
in the session. OIDC identities are stored as `(issuer, subject)` in
`core.oidc_user_identities`; email is not stored.

`POST /api/auth/session` accepts a valid public `userId` (lowercase ASCII
letters, digits, `_`, or `-`, up to 128 characters) only when development auth
is enabled. It creates or reuses the matching user, stores its numeric ID in the
session, and returns `{ "user": { "id": number, "userId": string, "username": string } }`.
`GET` returns the same user object (or `null` for an anonymous/stale session),
and `DELETE` logs out.
`GET /api/users/{userId}` is an unauthenticated lookup by public ID and returns
the user object or `404` when it does not exist.

Regenerate the shared API client's `openapi-fetch` types directly from the Rust service:

```sh
vp run @catlas/api-client#codegen
```

The OpenAPI JSON is streamed from `print-openapi` to `openapi-typescript` and
written to `packages/catlas-api-client/src/generated.ts`; no intermediate
specification file is written.

The API also applies pending embedded migrations before binding the HTTP server.
The `db:migrate` task uses the same migration runner and PostgreSQL advisory lock.
`db:schema` regenerates `src/schema.rs` from the migrated database with Diesel CLI. The generated
file is committed and must not be edited manually.

## Database reset

Local data can be recreated from the Diesel migrations:

```sh
vp run -w db:down:volumes
vp run -w db:up
vp run -w db:migrate
vp run -w db:schema
```

SQL migrations are the source of truth for the database schema. Create future forward-only
migrations from the repository root, edit the generated `up.sql`, apply it, and regenerate the
Diesel table definitions:

```sh
nix develop --command diesel migration generate --no-down <migration_name>
vp run -w db:migrate
vp run -w db:schema
```

Do not use `diesel migration generate --diff-schema`. Diesel `table!` definitions do not preserve
defaults, identity and generated expressions, checks, unique constraints, indexes, or PostGIS
geometry modifiers used by this schema.
