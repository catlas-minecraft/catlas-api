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
and the in-memory Poem session store. `POST /api/auth/session` accepts a
non-empty `username` and `DELETE` logs out.

Regenerate the Editor's `openapi-fetch` types directly from the Rust service:

```sh
vp run -w api:codegen
```

The OpenAPI JSON is streamed from `print-openapi` to `openapi-typescript`; no
intermediate specification file is written.

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
