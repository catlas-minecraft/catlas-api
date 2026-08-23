// Shared test fixtures.

import { vi } from "vite-plus/test";
import Collection from "ol/Collection.js";
import OlMap from "ol/Map.js";

export type FakeMap = {
  map: OlMap;
  setTarget: ReturnType<typeof vi.fn>;
  setView: ReturnType<typeof vi.fn>;
  setLayers: ReturnType<typeof vi.fn>;
  setLayerGroup: ReturnType<typeof vi.fn>;
  setPixelRatio: ReturnType<typeof vi.fn>;
  controls: Collection<unknown>;
  interactions: Collection<unknown>;
  overlays: Collection<unknown>;
};

export function createFakeMap(): FakeMap {
  const setTarget = vi.fn();
  const setView = vi.fn();
  const setLayers = vi.fn();
  const setLayerGroup = vi.fn();
  const setPixelRatio = vi.fn();
  const controls = new Collection<unknown>();
  const interactions = new Collection<unknown>();
  const overlays = new Collection<unknown>();

  const map = {
    getControls: () => controls,
    getInteractions: () => interactions,
    getOverlays: () => overlays,
    setLayerGroup,
    setLayers,
    setPixelRatio,
    setTarget,
    setView,
  } as unknown as OlMap;

  return {
    controls,
    interactions,
    map,
    overlays,
    setLayerGroup,
    setLayers,
    setPixelRatio,
    setTarget,
    setView,
  };
}
