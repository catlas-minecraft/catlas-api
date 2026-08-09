# Catlas feature registry

`features.json` describes client-side feature definitions shared by the editor and viewer. API
entities continue to store only ordinary string tags and structural geometry. A resolved feature
ID is derived at runtime and is never persisted.

## IDs and tags

- `portal=nether` is an entity tag.
- `portal.nether` is a stable, config-only feature ID.
- `displayName` labels the feature in client UI.
- An entity's map label comes from the tag configured by `viewer.label.tag`, normally `name`.

## Matching

A definition matches when the entity kind is in `appliesTo` and every `match.tags` entry equals the
entity tag value exactly. Additional entity tags are ignored. Candidates are ordered by:

1. `match.priority` descending, with an omitted priority treated as `0`.
2. Number of entries in `match.tags` descending.
3. Declaration order in `features` ascending.

The resolver returns the primary definition, every matching definition, and an ambiguity flag.
Unknown entities remain valid and consumers must render or edit them with a generic fallback.

## Creation

`editor.create.tags` is intentionally separate from `match.tags`. Matcher aliases can therefore
recognize old data without making the editor create old tags. Semantic validation requires creation
tags to include the matcher tags and to resolve back to the same feature.

Editor fields are declarative. Version 1 supports `text` and `select`; all resulting tag values are
strings. Raw tag editing remains available for unknown fields and values.

The registry can describe relation features, but the current editor and viewer do not load or
render relations yet.

## Zoom

Catlas zoom is renderer independent:

```text
pixelsPerWorldUnit = 2^(zoom - 3)
```

Leaflet zoom can be used directly. The D3 editor equivalent is `3 + log2(transform.k)`. Zoom
thresholds are inclusive.

## Validation

`features.schema.json` defines the strict JSON structure. The TypeScript semantic validator also
checks IDs, references, reserved tags, localization fallbacks, editor fields, creation round trips,
and matcher diagnostics. Unsupported schema versions and unknown properties are rejected.
