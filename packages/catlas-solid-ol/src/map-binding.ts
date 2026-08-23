import { createRenderEffect, getOwner, mergeProps, onCleanup } from "solid-js";
import { spread } from "solid-js/web";
import type Collection from "ol/Collection.js";
import OlMap from "ol/Map.js";
import LayerGroup from "ol/layer/Group.js";
import type { MapBinding, MapBindingOptions, MapOptions } from "./types.ts";

type CollectionValue<T> = Collection<T> | T[] | undefined;

type MapOptionsSnapshot = MapOptions;

function resolve<T>(value: T | (() => T)): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

function snapshotOptions(options: MapOptions): MapOptionsSnapshot {
  return { ...options };
}

function syncCollection<T>(collection: Collection<T>, value: CollectionValue<T>): void {
  if (value === collection) return;

  collection.clear();

  if (value === undefined) return;

  collection.extend(Array.isArray(value) ? value : value.getArray());
}

function applyMapOptions(map: OlMap, next: MapOptionsSnapshot, previous: MapOptionsSnapshot): void {
  if (next.view !== previous.view) {
    map.setView(next.view ?? null);
  }

  if (next.layers !== previous.layers) {
    if (next.layers instanceof LayerGroup) {
      map.setLayerGroup(next.layers);
    } else {
      map.setLayers(next.layers ?? []);
    }
  }

  if (next.pixelRatio !== previous.pixelRatio && next.pixelRatio !== undefined) {
    map.setPixelRatio(next.pixelRatio);
  }

  if (next.controls !== previous.controls) {
    syncCollection(map.getControls(), next.controls);
  }

  if (next.interactions !== previous.interactions) {
    syncCollection(map.getInteractions(), next.interactions);
  }

  if (next.overlays !== previous.overlays) {
    syncCollection(map.getOverlays(), next.overlays);
  }
}

function createDefaultMap(target: HTMLDivElement, options: MapOptions): OlMap {
  return new OlMap({ ...options, target });
}

export function createMapBinding({
  options: optionsInput,
  createMap,
  targetProps,
  disposeMap,
}: MapBindingOptions): MapBinding {
  const owner = getOwner();

  if (!owner) {
    throw new Error("createMapBinding must be used inside a Solid component owner.");
  }

  const target = document.createElement("div");
  const props = mergeProps({ tabIndex: 0 }, () => targetProps ?? {});

  spread(target, props, false, true);

  const initialOptions = snapshotOptions(resolve(optionsInput));
  const mapFactory = createMap ?? createDefaultMap;

  const map = mapFactory(target, initialOptions);

  createRenderEffect<MapOptionsSnapshot | undefined>((previous) => {
    const next = snapshotOptions(resolve(optionsInput));

    if (previous) {
      applyMapOptions(map, next, previous);
    }

    return next;
  });

  onCleanup(() => {
    map.setTarget(undefined);
    disposeMap?.(map);
  });

  return { target, map };
}
