// Map component tests.

import { createRoot } from "solid-js";
import { expect, test } from "vite-plus/test";
import { Map } from "./index.ts";
import { createFakeMap } from "./test-utils.ts";

test("renders DOM children into the map target", () => {
  const fake = createFakeMap();
  const child = document.createElement("span");
  let target!: HTMLDivElement;
  let disposeRoot!: () => void;

  createRoot((dispose) => {
    disposeRoot = dispose;
    target = Map({
      children: child,
      createMap: () => fake.map,
      options: {},
    }) as HTMLDivElement;
  });

  expect(target.firstChild).toBe(child);

  disposeRoot();
});
