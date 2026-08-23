import { createRenderEffect, onCleanup } from "solid-js";
import { useMap } from "./context.ts";
import type { JSX } from "solid-js";
import type { MapItemProps } from "./types.ts";

function resolve<T>(value: T | (() => T)): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

function mapItem(props: MapItemProps<unknown>): JSX.Element {
  const map = useMap();
  let detach: (() => void) | undefined;

  createRenderEffect(() => {
    const previousDetach = detach;
    detach = undefined;
    previousDetach?.();
    detach = props.attach(map, resolve(props.value)) ?? undefined;
  });

  onCleanup(() => {
    detach?.();
    detach = undefined;
  });

  return null;
}

/**
 * Attaches a value to the nearest OpenLayers map without rendering a DOM node.
 *
 * @example
 * ```tsx
 * import TileLayer from "ol/layer/Tile.js";
 * import OSM from "ol/source/OSM.js";
 * import { Map, MapItem } from "@catlas/solid-ol";
 *
 * const layer = new TileLayer({ source: new OSM() });
 *
 * function App() {
 *   return (
 *     <Map options={{}}>
 *       <MapItem
 *         value={layer}
 *         attach={(map, layer) => {
 *           map.addLayer(layer);
 *           return () => map.removeLayer(layer);
 *         }}
 *       />
 *     </Map>
 *   );
 * }
 * ```
 */
export const MapItem = mapItem as {
  <T>(props: MapItemProps<T>): JSX.Element;
  (props: MapItemProps<unknown>): JSX.Element;
};
