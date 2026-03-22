# Catlas API

Run the server package in development to start the API on `http://localhost:3000`.

## Local Development

Start PostGIS:

```sh
pnpm db:up
```

Apply migrations:

```sh
pnpm db:migrate
```

Start the API:

```sh
pnpm api:dev
```

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
