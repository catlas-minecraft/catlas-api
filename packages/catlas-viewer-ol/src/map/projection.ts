import Projection from "ol/proj/Projection.js";
import type { Coordinate } from "ol/coordinate.js";
import type { Extent } from "ol/extent.js";
import type { BBox, Point } from "@catlas/api-client";

export const CATLAS_PROJECTION_CODE = "CATLAS";
export const CATLAS_NATIVE_ZOOM = 3;
export const CATLAS_MIN_ZOOM = -1;
export const CATLAS_INITIAL_ZOOM = 0;
export const CATLAS_INITIAL_RESOLUTION = 2 ** (CATLAS_NATIVE_ZOOM - CATLAS_INITIAL_ZOOM);

export const catlasProjection = new Projection({
  code: CATLAS_PROJECTION_CODE,
  units: "pixels",
});

export type MapCoordinate = [number, number];

const reflect = (value: number): number => (value === 0 ? 0 : -value);

export const worldToMapCoordinate = (point: Pick<Point, "x" | "z">): MapCoordinate => [
  point.x,
  reflect(point.z),
];

export const mapToWorldCoordinate = ([x, y]: Coordinate): { x: number; z: number } => ({
  x,
  z: reflect(y),
});

export const resolutionForCatlasZoom = (zoom: number): number => 2 ** (CATLAS_NATIVE_ZOOM - zoom);

export const catlasZoomForResolution = (resolution: number): number =>
  CATLAS_NATIVE_ZOOM - Math.log2(resolution);

export const mapExtentToWorldBbox = (extent: Extent): BBox => [
  extent[0],
  -extent[3],
  extent[2],
  -extent[1],
];

export const worldBboxToMapExtent = (bbox: BBox): Extent => [bbox[0], -bbox[3], bbox[2], -bbox[1]];
