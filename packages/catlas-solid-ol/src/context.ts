import { createContext, useContext } from "solid-js";
import type OlMap from "ol/Map.js";

/**
 * The Solid context used to provide the current OpenLayers map to descendants.
 */
export const MapContext = createContext<OlMap>();

/**
 * Returns the OpenLayers map provided by the nearest `Map` component.
 *
 * @example
 * ```tsx
 * import { Map, useMap } from "@catlas/solid-ol";
 *
 * function MapInfo() {
 *   const map = useMap();
 *   return <span>Zoom: {map.getView().getZoom() ?? "-"}</span>;
 * }
 *
 * function App() {
 *   return (
 *     <Map options={{}}>
 *       <MapInfo />
 *     </Map>
 *   );
 * }
 * ```
 */
export function useMap(): OlMap {
  const map = useContext(MapContext);

  if (!map) {
    throw new Error("useMap must be used inside a Map component.");
  }

  return map;
}
