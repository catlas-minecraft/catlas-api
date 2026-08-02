# Catlas Geospatial API

This document is the contract for the Rust API in `packages/api_rs`. The API
is rooted at `/api`; the retired TypeScript API is not a compatibility target.

## Session

`GET`, `POST`, and `DELETE /api/auth/session` manage a temporary Poem
`MemoryStorage` cookie session. `POST` accepts `{ "userId": string }`, where the
public ID is 1–128 lowercase ASCII letters, digits, `_`, or `-`. It creates or
reuses that user ID without changing an existing display username, and returns
`{ "user": { "id": number, "userId": string, "username": string } }`. Sessions store only the
user ID; `GET` resolves it to a user (or returns `user: null` when stale).
Sessions are intentionally development-only and are lost on restart.

World, viewport, and entity reads are public. World, changeset, and entity
writes require a session. Any authenticated user may edit any world, but a
changeset may only be mutated, published, or abandoned by its creator.

`GET /api/users/{userId}` is an unauthenticated public lookup. It returns the
same user object (without `createdAt`) or `404` when the public ID is unknown.

## Worlds

A world is an independent namespace for changesets and geospatial entities.
It has an internal numeric ID, an immutable public `slug`, a display `name`, a
creator, and a creation timestamp. Slugs are 1–64 lowercase ASCII letters or
digits separated by single hyphens and are used in API and editor URLs.

`GET /api/worlds` and `GET /api/worlds/{worldSlug}` are public. Authenticated
users create worlds with `POST /api/worlds` and `{ "slug": string, "name":
string }`. World update and deletion are not currently supported.

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

Entity and changeset IDs remain globally allocated. Entity IDs are allocated
from the core sequences when draft creates are staged, allowing draft-created
ways to reference draft-created nodes. Gaps left by abandoned changesets are
expected. An entity and every entity reference must belong to its changeset's
world.

## Endpoints

- `GET /api/worlds`
- `GET /api/worlds/{worldSlug}`
- `POST /api/worlds`
- `GET /api/worlds/{worldSlug}/viewport`
- `GET /api/worlds/{worldSlug}/changesets`
- `POST /api/worlds/{worldSlug}/changesets`
- `POST /api/worlds/{worldSlug}/changesets/{id}/publish`
- `POST /api/worlds/{worldSlug}/changesets/{id}/abandon`
- `GET /api/worlds/{worldSlug}/nodes/{id}`
- `POST /api/worlds/{worldSlug}/nodes`
- `PATCH /api/worlds/{worldSlug}/nodes/{id}`
- `DELETE /api/worlds/{worldSlug}/nodes/{id}`
- `GET /api/worlds/{worldSlug}/ways/{id}`
- `POST /api/worlds/{worldSlug}/ways`
- `PATCH /api/worlds/{worldSlug}/ways/{id}`
- `DELETE /api/worlds/{worldSlug}/ways/{id}`
- `GET /api/worlds/{worldSlug}/relations/{id}`
- `POST /api/worlds/{worldSlug}/relations`
- `PATCH /api/worlds/{worldSlug}/relations/{id}`
- `DELETE /api/worlds/{worldSlug}/relations/{id}`

JSON fields use camelCase. Entity mutations include `changesetId`; patches and
deletes also include `expectedVersion`. Node geometry is `{x,y,z}`. Ways use an
ordered `nodeRefs` array. Relations currently support strict multipolygons made
from area ways with `outer`, `inner`, or null roles.

Nodes and ways have no dedicated semantic type field. Their meaning and other
application-specific metadata are represented by tags.

## Publication

Publication is a single database transaction:

1. Lock and verify the open changeset and owner.
2. Serialize publication within the world and recheck all base versions.
3. Validate the world's final core-plus-draft graph and geometry.
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
- Changesets, entities, way nodes, and relation members may not cross worlds.
- Deletion is rejected while an effective active parent still references the
  entity.
- Multipolygons require at least one outer area way and valid member roles.
- Public reads never inspect draft rows and exclude logically deleted entities.

## Operations

The API binds to `HOST` and `PORT`, defaulting to `127.0.0.1:3000`. OpenAPI is
available at `/api/openapi.json` and Scalar documentation at `/docs`.
