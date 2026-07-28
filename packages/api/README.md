# Catlas API

Run the server package in development to start the API on `http://localhost:3000`.

## Local Development

Enter the Nix development shell so the PostgreSQL-only Diesel CLI is available:

```sh
direnv allow
```

Start PostGIS:

```sh
vp run -w db:up
```

Set `DATABASE_URL` in the repository root `.env`, then apply Diesel migrations:

```sh
vp run -w db:migrate
```

Prepare local env:

```sh
cp packages/api/.env.example packages/api/.env
```

Start the API:

```sh
vp run --filter @catlas/api dev
```

Set `OTEL_ENABLED=true` in `packages/api/.env` to export existing Effect spans with OTLP.
You can point traces at a collector with `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, or use the shared
base URL `OTEL_EXPORTER_OTLP_ENDPOINT` and the API will derive `/v1/traces`.
Custom headers are supported via `OTEL_EXPORTER_OTLP_TRACES_HEADERS` or `OTEL_EXPORTER_OTLP_HEADERS`
using `key=value,key2=value2` format.

## Auth API

Create a session JWT:

```sh
curl -X POST http://localhost:3000/auth/sessions \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo-user"}'
```

Verify a session JWT:

```sh
curl -X POST http://localhost:3000/auth/sessions/verify \
  -H "Content-Type: application/json" \
  -d '{"sessionJwt":"<jwt>"}'
```

Revoke a session JWT:

```sh
curl -X POST http://localhost:3000/auth/sessions/revoke \
  -H "Content-Type: application/json" \
  -d '{"sessionJwt":"<jwt>"}'
```

## Authenticated Geospatial Requests

Geospatial write APIs require authentication and read the actor from either:

- `Authorization: Bearer <session-jwt>`
- `session_jwt` cookie

The resolved user id is stored into `changesets.created_by` and entity `created_by` / `updated_by`.

## OSM-Style Changeset Flow

The geospatial write API also supports an OSM-style lifecycle:

1. `PUT /changesets/create`
2. `POST /changesets/{id}/upload`
3. `PUT /changesets/{id}/close`

`create` returns a `{ changesetId }` payload, `upload` accepts batched create / modify / delete
operations for nodes, ways, and relations and returns a `diffResult`, and `close` finalizes the
changeset.
