import Feature from "ol/Feature.js";
import Fill from "ol/style/Fill.js";
import Icon from "ol/style/Icon.js";
import Stroke from "ol/style/Stroke.js";
import Style from "ol/style/Style.js";
import Text from "ol/style/Text.js";
import CircleStyle from "ol/style/Circle.js";
import type { Geometry } from "ol/geom.js";
import type { LabelCandidate, RenderNode, RenderPath } from "./viewport.ts";

const ICON_PATHS: Readonly<Record<string, string>> = {
  base: '<path d="M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z"/>',
  building: '<path d="M4 21V9l8-5 8 5v12M4 21h16M9 21v-5h6v5M8 11h2M14 11h2"/>',
  chest: '<path d="M4 7h16v12H4zM4 11h16M10 11v3h4v-3M6 7V5h12v2"/>',
  "automatic-storage":
    '<path d="M4 6h7v6H4zM13 12h7v6h-7zM15 5h4v4M19 5l-5 5M9 19H5v-4M5 19l5-5"/>',
  farm: '<path d="M4 5h16M4 10h16M4 15h16M4 20h16M7 5v15M12 5v15M17 5v15"/>',
  "nether-portal": '<path d="M6 3h12v18H6zM9 6h6v12H9zM10.5 8.5l3 3-3 3"/>',
  "tree-farm": '<path d="m12 4-7 9h4l-3 4h12l-3-4h4zM12 17v4"/>',
};

const featureIconSource = (iconId: string): string | null => {
  const path = ICON_PATHS[iconId];
  if (!path) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="6" fill="#0f172a" stroke="#f8fafc" stroke-opacity=".38"/><g fill="none" stroke="#f8fafc" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75">${path}</g></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const areaStyle = new Style({
  fill: new Fill({ color: "rgba(251, 146, 60, 0.22)" }),
  stroke: new Stroke({ color: "#f97316", width: 2 }),
});

const lineStyle = new Style({
  stroke: new Stroke({ color: "#f97316", width: 3 }),
});

const pointStyle = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: "#22c55e" }),
    stroke: new Stroke({ color: "#0f172a", width: 1 }),
  }),
});

const iconStyles = new Map<string, Style>();
const labelStyles = new Map<string, Style>();

const iconStyleFor = (iconId: string): Style | null => {
  const source = featureIconSource(iconId);
  if (!source) return null;
  const cached = iconStyles.get(iconId);
  if (cached) return cached;
  const style = new Style({
    image: new Icon({
      anchor: [0.5, 0.5],
      anchorXUnits: "fraction",
      anchorYUnits: "fraction",
      declutterMode: "none",
      height: 28,
      src: source,
      width: 28,
    }),
  });
  iconStyles.set(iconId, style);
  return style;
};

const labelStyleFor = (label: LabelCandidate): Style => {
  const cacheKey = `${label.text}\u0000${label.width}`;
  const cached = labelStyles.get(cacheKey);
  if (cached) return cached;
  const style = new Style({
    text: new Text({
      backgroundFill: new Fill({ color: "rgba(15, 23, 42, 0.88)" }),
      backgroundStroke: new Stroke({ color: "rgba(255, 255, 255, 0.14)", width: 1 }),
      declutterMode: "none",
      fill: new Fill({ color: "#f8fafc" }),
      font: "600 12px Geist, system-ui, sans-serif",
      offsetY: -24,
      padding: [3, 8, 3, 8],
      text: label.displayText,
      textAlign: "center",
      textBaseline: "middle",
    }),
  });
  labelStyles.set(cacheKey, style);
  return style;
};

const iconIdFor = (feature: RenderPath["feature"]): string | null => feature?.viewer?.icon ?? null;

export const styleForPath = (path: RenderPath): Style =>
  path.geometryKind === "area" ? areaStyle : lineStyle;

export const styleForNode = (node: RenderNode): Style => {
  const iconId = iconIdFor(node.feature);
  return (iconId && iconStyleFor(iconId)) || pointStyle;
};

export const styleForLabel = (label: LabelCandidate): Style => labelStyleFor(label);

export type ViewportFeatureProperties =
  | { readonly kind: "path"; readonly render: RenderPath }
  | { readonly kind: "node"; readonly render: RenderNode }
  | { readonly kind: "label"; readonly render: LabelCandidate };

export const featureFromPath = (geometry: Geometry, path: RenderPath) => {
  const feature = new Feature<Geometry>({ geometry });
  feature.setProperties({
    accessibleName: path.accessibleName,
    catlas: { kind: "path", render: path } satisfies ViewportFeatureProperties,
  });
  feature.setStyle(styleForPath(path));
  return feature;
};

export const featureFromNode = (geometry: Geometry, node: RenderNode) => {
  const feature = new Feature<Geometry>({ geometry });
  feature.setProperties({
    accessibleName: node.accessibleName,
    catlas: { kind: "node", render: node } satisfies ViewportFeatureProperties,
  });
  feature.setStyle(styleForNode(node));
  return feature;
};

export const featureFromLabel = (geometry: Geometry, label: LabelCandidate) => {
  const feature = new Feature<Geometry>({ geometry });
  feature.setProperties({
    accessibleName: label.text,
    catlas: { kind: "label", render: label } satisfies ViewportFeatureProperties,
  });
  feature.setStyle(styleForLabel(label));
  return feature;
};
