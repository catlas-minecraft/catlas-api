// Internal map binding tests.

import { createRoot, createSignal } from "solid-js";
import { expect, test, vi } from "vite-plus/test";
import OlMap from "ol/Map.js";
import LayerGroup from "ol/layer/Group.js";
import type BaseLayer from "ol/layer/Base.js";
import type Control from "ol/control/Control.js";
import type Interaction from "ol/interaction/Interaction.js";
import type Overlay from "ol/Overlay.js";
import { createMapBinding } from "./map-binding.ts";
import type { MapBinding, MapOptions } from "./types.ts";
import { createFakeMap } from "./test-utils.ts";

test("creates a target and applies reactive DOM props with spread", () => {
  const className = createSignal("initial");
  const fake = createFakeMap();
  let binding!: MapBinding;
  let disposeRoot!: () => void;

  createRoot((dispose) => {
    disposeRoot = dispose;
    binding = createMapBinding({
      createMap: () => fake.map,
      options: {},
      targetProps: {
        get "aria-label"() {
          return "Map";
        },
        get class() {
          return className[0]();
        },
      },
    });
  });

  expect(binding.target).toBeInstanceOf(HTMLDivElement);
  expect(binding.target.tabIndex).toBe(0);
  expect(binding.target.className).toBe("initial");
  expect(binding.target.getAttribute("aria-label")).toBe("Map");

  className[1]("updated");

  expect(binding.target.className).toBe("updated");

  disposeRoot();
  expect(fake.setTarget).toHaveBeenCalledWith(undefined);
});

test("creates an OpenLayers map with the default factory", () => {
  let binding!: MapBinding;
  let disposeRoot!: () => void;

  createRoot((dispose) => {
    disposeRoot = dispose;
    binding = createMapBinding({ options: {} });
  });

  expect(binding.map).toBeInstanceOf(OlMap);
  expect(binding.map.getTargetElement()).toBe(binding.target);

  disposeRoot();
});

test("updates supported map options without recreating the map", () => {
  const firstView = {} as NonNullable<MapOptions["view"]>;
  const secondView = {} as NonNullable<MapOptions["view"]>;
  const firstControl = {} as Control;
  const secondControl = {} as Control;
  const firstInteraction = {} as Interaction;
  const secondInteraction = {} as Interaction;
  const firstLayer = {} as BaseLayer;
  const secondLayer = {} as BaseLayer;
  const firstOverlay = {} as Overlay;
  const secondOverlay = {} as Overlay;
  const [options, setOptions] = createSignal<MapOptions>({
    controls: [firstControl],
    interactions: [firstInteraction],
    layers: [firstLayer],
    overlays: [firstOverlay],
    pixelRatio: 1,
    view: firstView,
  });
  const fake = createFakeMap();
  let binding!: MapBinding;
  let disposeRoot!: () => void;

  createRoot((dispose) => {
    disposeRoot = dispose;
    binding = createMapBinding({
      createMap: () => fake.map,
      options,
    });
  });

  setOptions({
    controls: [secondControl],
    interactions: [secondInteraction],
    layers: [secondLayer],
    overlays: [secondOverlay],
    pixelRatio: 2,
    view: secondView,
  });

  expect(fake.setView).toHaveBeenCalledWith(secondView);
  expect(fake.setLayers).toHaveBeenCalledWith([secondLayer]);
  expect(fake.setPixelRatio).toHaveBeenCalledWith(2);
  expect(fake.controls.getArray()).toEqual([secondControl]);
  expect(fake.interactions.getArray()).toEqual([secondInteraction]);
  expect(fake.overlays.getArray()).toEqual([secondOverlay]);
  expect(binding.map).toBe(fake.map);

  disposeRoot();
});

test("uses setLayerGroup for a LayerGroup option", () => {
  const layerGroup = new LayerGroup();
  const [options, setOptions] = createSignal<MapOptions>({ layers: [] });
  const fake = createFakeMap();
  let disposeRoot!: () => void;

  createRoot((dispose) => {
    disposeRoot = dispose;
    createMapBinding({
      createMap: () => fake.map,
      options,
    });
  });

  setOptions({ layers: layerGroup });

  expect(fake.setLayerGroup).toHaveBeenCalledWith(layerGroup);
  expect(fake.setLayers).not.toHaveBeenCalled();

  disposeRoot();
});

test("does not recreate the map for construction-only options", () => {
  const [options, setOptions] = createSignal<MapOptions>({ maxTilesLoading: 16 });
  const fake = createFakeMap();
  const createMap = vi.fn(() => fake.map);
  let disposeRoot!: () => void;

  createRoot((dispose) => {
    disposeRoot = dispose;
    createMapBinding({ createMap, options });
  });

  setOptions({ maxTilesLoading: 32 });

  expect(createMap).toHaveBeenCalledTimes(1);
  expect(fake.setView).not.toHaveBeenCalled();
  expect(fake.setLayers).not.toHaveBeenCalled();
  expect(fake.setPixelRatio).not.toHaveBeenCalled();

  disposeRoot();
});

test("runs map cleanup when the owning root is disposed", () => {
  const fake = createFakeMap();
  const disposeMap = vi.fn();
  let disposeRoot!: () => void;

  createRoot((dispose) => {
    disposeRoot = dispose;
    createMapBinding({
      createMap: () => fake.map,
      disposeMap,
      options: {},
    });
  });

  disposeRoot();

  expect(disposeMap).toHaveBeenCalledTimes(1);
  expect(fake.setTarget).toHaveBeenCalledWith(undefined);
});

test("requires a Solid owner", () => {
  expect(() => createMapBinding({ options: {} })).toThrow(
    "createMapBinding must be used inside a Solid component owner.",
  );
});
