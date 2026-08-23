import type { Accessor, JSX } from "solid-js";
import type OlMap from "ol/Map.js";
import type { MapOptions as OlMapOptions } from "ol/Map.js";

/** OpenLayers map options used by `Map`. */
export type MapOptions = Omit<OlMapOptions, "target">;

/** A value that can be passed directly or provided by a Solid accessor. */
export type MaybeAccessor<T> = T | Accessor<T>;

/** HTML attributes forwarded to the generated map target element. */
export type MapTargetProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "ref">;

/**
 * Creates the OpenLayers map instance used by `Map`.
 */
export type MapFactory = (target: HTMLDivElement, options: MapOptions) => OlMap;

export type MapBindingOptions = {
  options: MaybeAccessor<MapOptions>;
  createMap?: MapFactory;
  targetProps?: MapTargetProps;
  disposeMap?: (map: OlMap) => void;
};

export type MapBinding = {
  readonly target: HTMLDivElement;
  readonly map: OlMap;
};

/**
 * Props accepted by the `Map` component.
 */
export type MapProps = Omit<MapBindingOptions, "targetProps"> &
  Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "ref"> & {
    children?: JSX.Element;
  };

/**
 * Props for attaching a reactive value to an OpenLayers map.
 *
 * @typeParam T The value managed by the item.
 */
export type MapItemProps<T> = {
  /** The value to pass to `attach`. */
  value: MaybeAccessor<T>;
  /** Attaches the value to the map. */
  attach: (map: OlMap, value: T) => void | (() => void);
};
