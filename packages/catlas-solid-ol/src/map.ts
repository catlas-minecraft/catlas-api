import { createComponent, splitProps } from "solid-js";
import { spread } from "solid-js/web";
import { MapContext } from "./context.ts";
import { createMapBinding } from "./map-binding.ts";
import type { JSX } from "solid-js";
import type { MapProps } from "./types.ts";

/**
 * Creates an OpenLayers map and returns its generated target element.
 *
 * @example
 * ```tsx
 * import View from "ol/View.js";
 * import TileLayer from "ol/layer/Tile.js";
 * import OSM from "ol/source/OSM.js";
 * import { Map } from "@catlas/solid-ol";
 *
 * const layers = [new TileLayer({ source: new OSM() })];
 * const view = new View({ center: [0, 0], zoom: 2 });
 *
 * function App() {
 *   return <Map class="map" options={{ layers, view }} />;
 * }
 * ```
 */
export function Map(props: MapProps): JSX.Element {
  const [mapProps, targetProps] = splitProps(props, [
    "children",
    "createMap",
    "disposeMap",
    "options",
  ]);

  const binding = createMapBinding({
    createMap: mapProps.createMap,
    disposeMap: mapProps.disposeMap,
    options: mapProps.options,
    targetProps,
  });

  const children = createComponent(MapContext.Provider, {
    value: binding.map,
    get children() {
      return mapProps.children;
    },
  });

  spread(binding.target, { children }, false, false);

  return binding.target;
}
