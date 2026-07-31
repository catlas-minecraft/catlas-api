# Catlas Geospatial API

This document is the contract for the Rust API in `packages/api_rs`. The API
is rooted at `/api`; the retired TypeScript API is not a compatibility target.

## Session

`GET`, `POST`, and `DELETE /api/auth/session` manage a temporary Poem
`MemoryStorage` cookie session. `POST` accepts `{ "username": string }`,
automatically creates or reuses the exact case-sensitive username, and returns
`{ "user": { "id": number, "username": string } }`. Sessions store only the
user ID; `GET` resolves it to a user (or returns `user: null` when stale).
Sessions are intentionally development-only and are lost on restart.

Viewport and entity reads are public. Changeset and entity writes require a
session and may only mutate changesets owned by the session user ID.

## Coordinates

Coordinates use X/Y/Z, with XZ as the ground plane and Y as height. Nodes store
`mc_x`, `mc_y`, and `mc_z`; PostGIS search geometry is `(mc_x, mc_z)` with SRID 0. The viewport `bbox` is `minX,minZ,maxX,maxZ`.

## Published And Draft Data

`core` contains only published entity state. `history` contains the resulting
snapshot for every published version. `derived` contains rebuildable PostGIS
geometry for published ways and multipolygon relations.

Open changesets write complete proposed parent states to `draft.nodes`,
`draft.ways`, and `draft.relations`. A parent mutation is `create`, `update`,
or `delete`; updates and deletes retain the published `base_version`. Draft
ways and relations own complete ordered child lists in `draft.way_nodes` and
`draft.relation_members`.

Entity IDs are allocated from the core sequences when draft creates are
staged. This allows draft-created ways to reference draft-created nodes. Gaps
left by abandoned changesets are expected.

## Endpoints

- `GET /api/viewport`
- `GET /api/changesets`
- `POST /api/changesets`
- `POST /api/changesets/{id}/publish`
- `POST /api/changesets/{id}/abandon`
- `GET /api/nodes/{id}`
- `POST /api/nodes`
- `PATCH /api/nodes/{id}`
- `DELETE /api/nodes/{id}`
- `GET /api/ways/{id}`
- `POST /api/ways`
- `PATCH /api/ways/{id}`
- `DELETE /api/ways/{id}`
- `GET /api/relations/{id}`
- `POST /api/relations`
- `PATCH /api/relations/{id}`
- `DELETE /api/relations/{id}`

JSON fields use camelCase. Entity mutations include `changesetId`; patches and
deletes also include `expectedVersion`. Node geometry is `{x,y,z}`. Ways use an
ordered `nodeRefs` array. Relations currently support strict multipolygons made
from area ways with `outer`, `inner`, or null roles.

## Publication

Publication is a single database transaction:

1. Lock and verify the open changeset and owner.
2. Serialize publication and recheck all base versions.
3. Validate the final core-plus-draft graph and geometry.
4. Apply parent and ordered child state to core.
5. Increment each changed entity once and record resulting history snapshots.
6. Rebuild XZ way and multipolygon relation geometry.
7. Mark the changeset published and remove its draft rows.

Any failure rolls back all core, history, derived, status, and draft changes.
Abandoning an open changeset removes its drafts without touching published
state.

## Validation

- Coordinates and bbox values must be finite.
- Tags are string maps and may not contain reserved structural keys.
- Lines require at least two distinct nodes.
- Areas require a closed ring with at least three distinct nodes.
- Active ways and relations may reference only effective active entities.
- Deletion is rejected while an effective active parent still references the
  entity.
- Multipolygons require at least one outer area way and valid member roles.
- Public reads never inspect draft rows and exclude logically deleted entities.

## Operations

The API binds to `HOST` and `PORT`, defaulting to `127.0.0.1:3000`. OpenAPI is
available at `/api/openapi.json` and Scalar documentation at `/docs`.
