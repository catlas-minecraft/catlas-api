import * as d3 from "d3";
import { describe, expect, test } from "vite-plus/test";
import {
  getInitialTransform,
  getViewportBbox,
  TILE_PIXEL_SIZE,
  TILE_WORLD_SIZE,
  screenToWorld,
  worldToScreen,
} from "../src/lib/editor/util";

describe("editor world scale", () => {
  test("maps one 512-pixel tile to 512 world cells at the initial zoom", () => {
    const transform = getInitialTransform({ width: 1024, height: 512 });

    expect(TILE_PIXEL_SIZE).toBe(512);
    expect(TILE_WORLD_SIZE).toBe(512);
    expect(transform.k).toBe(1);
    expect(transform.applyX(TILE_WORLD_SIZE) - transform.applyX(0)).toBe(TILE_PIXEL_SIZE);
  });

  test("requests viewport bounds in world-cell coordinates", () => {
    const transform = d3.zoomIdentity.translate(150, 50).scale(2);

    expect(getViewportBbox(transform, { width: 200, height: 100 })).toEqual([-75, -25, 25, 25]);
  });

  test("keeps positive world X to the right of the screen", () => {
    const transform = d3.zoomIdentity.translate(100, 50).scale(2);
    const point = { x: 12, z: -7 };

    expect(worldToScreen(transform, point)).toEqual([124, 36]);
    expect(screenToWorld(transform, [124, 36])).toEqual({ x: 12, y: 0, z: -7 });
  });
});
