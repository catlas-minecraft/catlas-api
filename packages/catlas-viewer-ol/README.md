# Catlas OpenLayers viewer

`@catlas/viewer-ol` is the SolidJS + OpenLayers viewer. It keeps the existing
React + Leaflet viewer in `@catlas/viewer` available while the new viewer is
developed separately.

Run it from the repository root with:

```sh
vp run --filter=@catlas/viewer-ol dev
vp run --filter=@catlas/viewer-ol build
```

The viewer uses Catlas world coordinates (`x`, `z`) as map coordinates
`[x, -z]`, a 512px tile grid, and the relative `/tiles/{x}.{y}.gif` tile
contract. X increases to the right; OpenLayers' Y-up map coordinates reflect
Z only. Feature data is requested from the shared `@catlas/api-client`
viewport service and rendered with OpenLayers `VectorLayer`s.
