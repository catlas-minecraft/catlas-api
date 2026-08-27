import type * as d3 from "d3";
import { getElementSize, syncCanvas, TILE_WORLD_SIZE } from "./util";

const DEFAULT_TILE_URL = "http://viewer.catlas.localhost:1355/tiles/{x}.{y}.gif";

export class TileCanvasLayer {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  readonly #imageCache = new Map<string, HTMLImageElement>();
  readonly #root: HTMLDivElement;
  readonly #tileUrl: string;
  #animationFrameId: number | null = null;
  #pendingTransform: d3.ZoomTransform | null = null;

  constructor(root: HTMLDivElement, tileUrl = DEFAULT_TILE_URL) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is not available.");

    root.append(canvas);
    this.#canvas = canvas;
    this.#context = context;
    this.#root = root;
    this.#tileUrl = tileUrl;
    this.resize();
  }

  resize() {
    syncCanvas(this.#canvas, this.#context, getElementSize(this.#root));
  }

  setTransform(transform: d3.ZoomTransform) {
    this.#pendingTransform = transform;
    this.#scheduleRender();
  }

  #scheduleRender() {
    if (this.#animationFrameId !== null) return;
    this.#animationFrameId = requestAnimationFrame(() => {
      this.#animationFrameId = null;
      if (this.#pendingTransform) this.#render(this.#pendingTransform);
    });
  }

  #render(transform: d3.ZoomTransform) {
    const size = getElementSize(this.#root);
    syncCanvas(this.#canvas, this.#context, size);
    this.#context.clearRect(0, 0, size.width, size.height);

    // The editor scene uses world X to the right and world Z downward, so tile
    // indices use the same sign convention as the rendered scene.
    const [minSceneX, minSceneZ] = transform.invert([0, 0]);
    const [maxSceneX, maxSceneZ] = transform.invert([size.width, size.height]);
    const minTileX = Math.floor(minSceneX / TILE_WORLD_SIZE);
    const maxTileX = Math.ceil(maxSceneX / TILE_WORLD_SIZE);
    const minTileY = Math.floor(minSceneZ / TILE_WORLD_SIZE);
    const maxTileY = Math.ceil(maxSceneZ / TILE_WORLD_SIZE);

    for (let tileY = minTileY; tileY < maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX < maxTileX; tileX += 1) {
        const left = transform.applyX(tileX * TILE_WORLD_SIZE);
        const top = transform.applyY(tileY * TILE_WORLD_SIZE);
        const right = transform.applyX((tileX + 1) * TILE_WORLD_SIZE);
        const bottom = transform.applyY((tileY + 1) * TILE_WORLD_SIZE);
        const image = this.#loadTileImage(tileX, tileY);

        if (image.complete && image.naturalWidth > 0) {
          this.#context.drawImage(
            image,
            Math.floor(left),
            Math.floor(top),
            Math.ceil(right) - Math.floor(left),
            Math.ceil(bottom) - Math.floor(top),
          );
        }
      }
    }
  }

  #loadTileImage(x: number, y: number) {
    const key = `${x}.${y}`;
    const cached = this.#imageCache.get(key);
    if (cached) return cached;

    const image = new Image();
    image.decoding = "async";
    image.onload = () => this.#scheduleRender();
    image.src = this.#tileUrl.replace("{x}", String(x)).replace("{y}", String(y));
    this.#imageCache.set(key, image);
    return image;
  }

  destroy() {
    if (this.#animationFrameId !== null) cancelAnimationFrame(this.#animationFrameId);
    for (const image of this.#imageCache.values()) image.onload = null;
    this.#imageCache.clear();
    this.#canvas.remove();
  }
}
