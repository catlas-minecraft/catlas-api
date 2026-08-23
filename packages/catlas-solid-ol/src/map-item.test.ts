// MapItem component tests.

import { createComponent, createRoot, createSignal } from "solid-js";
import { expect, test } from "vite-plus/test";
import { Map, MapItem } from "./index.ts";
import { createFakeMap } from "./test-utils.ts";

test("MapItem attaches, replaces, and detaches values through Map context", () => {
  const firstValue = {};
  const secondValue = {};
  const [value, setValue] = createSignal(firstValue);
  const attached: unknown[] = [];
  const detached: unknown[] = [];
  const fake = createFakeMap();
  let target!: HTMLDivElement;
  let disposeRoot!: () => void;

  createRoot((dispose) => {
    disposeRoot = dispose;
    target = Map({
      createMap: () => fake.map,
      get children() {
        return createComponent(MapItem, {
          attach: (_map, item) => {
            attached.push(item);
            return () => detached.push(item);
          },
          value,
        });
      },
      options: {},
    }) as HTMLDivElement;
  });

  expect(target).toBeInstanceOf(HTMLDivElement);
  expect(attached).toEqual([firstValue]);

  setValue(secondValue);

  expect(detached).toEqual([firstValue]);
  expect(attached).toEqual([firstValue, secondValue]);

  disposeRoot();

  expect(detached).toEqual([firstValue, secondValue]);
});
