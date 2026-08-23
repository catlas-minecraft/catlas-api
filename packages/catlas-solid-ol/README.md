# @catlas/solid-ol

Solid bindings for OpenLayers. The package is browser-only for now and does not provide SSR support.

## Basic usage

```tsx
import { createSignal } from "solid-js";
import OSM from "ol/source/OSM.js";
import TileLayer from "ol/layer/Tile.js";
import View from "ol/View.js";
import "ol/ol.css";
import { Map } from "@catlas/solid-ol";

const layers = [new TileLayer({ source: new OSM() })];
const view = new View({ center: [0, 0], zoom: 2 });

function App() {
  const [options] = createSignal({ layers, view });

  return <Map class="map" options={options} />;
}
```

`createMap` is optional. When omitted, the package creates `new ol/Map` with the supplied options and generated target. `Map` creates the target element internally, so consumers do not need `ref` or `onMount`.

## OpenLayers children

Use `useMap` and `MapItem` to attach any OpenLayers object to the map:

```tsx
<Map options={options}>
  <MapItem
    value={layer}
    attach={(map, layer) => {
      map.addLayer(layer);
      return () => map.removeLayer(layer);
    }}
  />
</Map>
```

`MapItem` detaches the previous value before attaching a replacement. Custom child components can use `useMap()` directly. A child that returns DOM is rendered into the map target.

The map lifecycle is tied to the surrounding Solid component owner and is cleaned up automatically when that owner is disposed.

## Development

- Install dependencies:

```bash
vp install
```

- Run the unit tests:

```bash
vp test
```

- Build the library:

```bash
vp pack
```
