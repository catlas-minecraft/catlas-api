# Catlas Editor

An iD-style world editor for Catlas game maps. The editor works in the XZ plane,
keeps Y as an inspected property, and synchronizes entities through the Catlas API.
Each map tile covers `512 x 512` world cells. At the initial zoom level, one cell is
rendered as one CSS pixel, matching the native `512 x 512` tile image. World X
increases to the right and world Z increases downward; the tile layer uses the
same screen-plane direction.

## Architecture

The implementation is split into the same layers that make an interactive map
editor manageable:

1. `Graph` is the immutable entity store for nodes and ways.
2. `History` records annotated graph transitions and provides undo/redo.
3. `Actions` are small graph transformations such as moving a node or changing tags.
4. `Modes` and pointer behaviors decide how input becomes actions.
5. `Operations` expose user commands with availability, disabled reasons, and `execute()`.
6. `Snapping` applies geometry-based coordinate policies while drawing and moving entities.
7. `Validation` reports structural issues before upload.
8. `Renderer` draws areas, lines, nodes, midpoints, and active drawing state with D3/SVG.
9. `Sync` loads viewport entities and uploads changesets through the Catlas API client.
10. React renders the toolbar, inspector, validation state, and save controls around the editor.

## Authentication

Editing is available without a session, but publishing requires a Catlas API session.
When OIDC is configured, the toolbar starts the API's OpenID Connect login and returns to the
current editor route after authentication. The API stores the resulting identity in its
HttpOnly session cookie. A developer sign-in through `POST /auth/session` remains available only
when development auth is enabled. The editor checks the session on startup and immediately
before publishing. Signing out deletes the session when the API is reachable and always clears
the local authentication state.

Relations are deliberately outside the current editing surface. The graph and API
boundaries leave room for them without mixing relation behavior into the first
point/line/area milestone.

## Public Editor API

`CatlasEditor` owns the mutable session and exposes snapshots through
`getSnapshot()` and `subscribe()`. UI commands use methods such as `setMode()`,
`undo()`, `redo()`, and `save()`. Commands that need availability
metadata are obtained with `operation(id)`.

## Development

```sh
vp install
vp dev
vp check
vp test
vp build
```

The default development setup proxies `/api` to the Catlas API and `/tiles` to the
tile service. Editing remains local when either service is unavailable, so a failed
load or publish does not discard the current history.
