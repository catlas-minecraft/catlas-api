import { describe, expect, test } from "vite-plus/test";
import {
  CATLAS_MIN_ZOOM,
  catlasProjection,
  catlasZoomForResolution,
  resolutionForCatlasZoom,
  mapExtentToWorldBbox,
  mapToWorldCoordinate,
  worldBboxToMapExtent,
  worldToMapCoordinate,
} from "./projection.ts";
import { CATLAS_TILE_SIZE, catlasTileUrl } from "./tiles.ts";

describe("Catlas OpenLayers coordinate contract", () => {
  test("uses a non-wrapping pixel projection for the map view", () => {
    expect(catlasProjection.getCode()).toBe("CATLAS");
    expect(catlasProjection.getUnits()).toBe("pixels");
  });

  test("maps world x/z into the OpenLayers y-up coordinate system", () => {
    expect(worldToMapCoordinate({ x: 12, z: -7 })).toEqual([12, 7]);
    expect(mapToWorldCoordinate([12, 7])).toEqual({ x: 12, z: -7 });
  });

  test("converts view extents and API bboxes without reflecting X", () => {
    const extent = [-100, -50, 300, 150];
    expect(mapExtentToWorldBbox(extent)).toEqual([-100, -150, 300, 50]);
    expect(worldBboxToMapExtent([-100, -150, 300, 50])).toEqual(extent);
  });

  test("keeps Catlas native zoom 3 at one map pixel per world unit", () => {
    expect(resolutionForCatlasZoom(3)).toBe(1);
    expect(resolutionForCatlasZoom(0)).toBe(8);
    expect(catlasZoomForResolution(0.25)).toBe(5);
  });

  test("allows one additional wide-area zoom level below the initial view", () => {
    expect(CATLAS_MIN_ZOOM).toBe(-1);
    expect(resolutionForCatlasZoom(CATLAS_MIN_ZOOM)).toBe(16);
  });

  test("builds tile URLs using the map tile coordinates", () => {
    expect(CATLAS_TILE_SIZE).toBe(512);
    expect(catlasTileUrl("/tiles/{x}.{y}.gif", 2, 4)).toBe("/tiles/2.4.gif");
  });
});
