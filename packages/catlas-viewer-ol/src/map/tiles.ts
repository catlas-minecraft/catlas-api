import ImageTile from "ol/source/ImageTile.js";
import TileGrid from "ol/tilegrid/TileGrid.js";
import TileLayer from "ol/layer/Tile.js";
import { catlasProjection } from "./projection.ts";

export const CATLAS_TILE_SIZE = 512;

export const catlasTileUrl = (urlTemplate: string, x: number, y: number): string =>
  urlTemplate.replace("{x}", String(x)).replace("{y}", String(y));

export const createCatlasTileLayer = (urlTemplate = "/tiles/{x}.{y}.gif") => {
  const source = new ImageTile({
    projection: catlasProjection,
    tileGrid: new TileGrid({
      origin: [0, 0],
      resolutions: [1],
      tileSize: CATLAS_TILE_SIZE,
    }),
    url: (_z, x, y) => catlasTileUrl(urlTemplate, x, y),
    wrapX: false,
    interpolate: false,
    transition: 0,
  });

  return new TileLayer({
    className: "catlas-tile-layer",
    source,
    zIndex: 0,
  });
};
