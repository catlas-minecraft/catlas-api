import * as d3 from "d3";
import type { Point3D } from "./types";

export type Size = { readonly height: number; readonly width: number };
export type Extent = [[number, number], [number, number]];

export const TILE_PIXEL_SIZE = 512;
export const TILE_WORLD_SIZE = 512;
const INITIAL_PIXELS_PER_WORLD_UNIT = TILE_PIXEL_SIZE / TILE_WORLD_SIZE;
const FALLBACK_SIZE: Size = { height: 200, width: 200 };

export const createSvgElement = () => document.createElementNS("http://www.w3.org/2000/svg", "svg");

export const getElementSize = (element: HTMLElement): Size => {
  const rect = element.getBoundingClientRect();
  return {
    width: rect.width || window.innerWidth || FALLBACK_SIZE.width,
    height: rect.height || window.innerHeight || FALLBACK_SIZE.height,
  };
};

export const getViewportExtent = ({ height, width }: Size): Extent => [
  [0, 0],
  [width, height],
];

export const getInitialTransform = ({ height, width }: Size) =>
  d3.zoomIdentity.translate(width / 2, height / 2).scale(INITIAL_PIXELS_PER_WORLD_UNIT);

export const getZoomScaleExtent = (): [number, number] => [1 / 16, 32];

export const worldToScreen = (transform: d3.ZoomTransform, point: Pick<Point3D, "x" | "z">) =>
  transform.apply([point.x, point.z]) as [number, number];

export const screenToWorld = (
  transform: d3.ZoomTransform,
  screen: readonly [number, number],
  y = 0,
): Point3D => {
  const [sceneX, sceneZ] = transform.invert([screen[0], screen[1]]);
  return { x: sceneX, y, z: sceneZ };
};

export const getViewportBbox = (
  transform: d3.ZoomTransform,
  { width, height }: Size,
): readonly [number, number, number, number] => {
  const topLeft = screenToWorld(transform, [0, 0]);
  const bottomRight = screenToWorld(transform, [width, height]);
  return [
    Math.min(topLeft.x, bottomRight.x),
    Math.min(topLeft.z, bottomRight.z),
    Math.max(topLeft.x, bottomRight.x),
    Math.max(topLeft.z, bottomRight.z),
  ];
};

export const syncCanvas = (
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  size: Size,
) => {
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(size.width * pixelRatio));
  const height = Math.max(1, Math.round(size.height * pixelRatio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.imageSmoothingEnabled = false;
};
