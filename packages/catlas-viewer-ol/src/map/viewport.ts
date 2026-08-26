import type { FeatureRegistry, ResolvedFeature } from "@catlas/features";
import { defaultFeatureRegistry } from "@catlas/features";
import { resolveLocalizedText, resolveTaggedText } from "@catlas/features/localization";
import type { BBox, Viewport } from "@catlas/api-client";
import type { MapCoordinate } from "./projection.ts";
import { worldToMapCoordinate } from "./projection.ts";
import { anchorForPath } from "./geometry.ts";

export { anchorForPath } from "./geometry.ts";

export type LabelCandidate = {
  readonly key: string;
  readonly coordinate: MapCoordinate;
  readonly text: string;
  readonly displayText: string;
  readonly priority: number;
  readonly width: number;
};

export type RenderPath = {
  readonly id: number;
  readonly geometryKind: "line" | "area";
  readonly coordinates: readonly MapCoordinate[];
  readonly coordinate: MapCoordinate;
  readonly feature: ResolvedFeature | null;
  readonly featureVisible: boolean;
  readonly accessibleName: string;
};

export type RenderNode = {
  readonly id: number;
  readonly coordinate: MapCoordinate;
  readonly feature: ResolvedFeature | null;
  readonly accessibleName: string;
};

export type ProjectedViewport = {
  readonly polygons: readonly RenderPath[];
  readonly polylines: readonly RenderPath[];
  readonly markers: readonly RenderNode[];
  readonly labels: readonly LabelCandidate[];
};

export type LabelCollisionContext = {
  readonly mapSize: readonly [number, number];
  readonly coordinateToPixel: (coordinate: MapCoordinate) => readonly [number, number] | null;
};

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export const labelWidth = (text: string): number => {
  let units = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    units += (segment.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
  }
  return Math.min(240, Math.max(48, units * 7 + 16));
};

const labelDisplayText = (text: string, width: number): string => {
  const maxUnits = Math.max(4, Math.floor((width - 16) / 7));
  let units = 0;
  let result = "";
  for (const { segment } of graphemeSegmenter.segment(text)) {
    const segmentUnits = (segment.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
    if (units + segmentUnits > maxUnits) return `${result}…`;
    units += segmentUnits;
    result += segment;
  }
  return result;
};

const pathAccessibleName = (
  kind: "line" | "area",
  tags: Readonly<Record<string, string>>,
  feature: ResolvedFeature | null,
  registry: FeatureRegistry,
  locale: string,
) => {
  const featureName = feature
    ? resolveLocalizedText(feature.displayName, locale, registry.document.defaultLocale)
    : null;
  const nameTag = feature?.viewer?.label?.tag ?? "name";
  const entityName = resolveTaggedText(tags, nameTag, locale);
  if (featureName && entityName) return `${featureName}: ${entityName}`;
  return entityName ?? featureName ?? `Unknown ${kind}`;
};

const nodeAccessibleName = (
  tags: Readonly<Record<string, string>>,
  feature: ResolvedFeature | null,
  registry: FeatureRegistry,
  locale: string,
) => {
  const featureName = feature
    ? resolveLocalizedText(feature.displayName, locale, registry.document.defaultLocale)
    : null;
  const nameTag = feature?.viewer?.label?.tag ?? "name";
  const entityName = resolveTaggedText(tags, nameTag, locale);
  if (featureName && entityName) return `${featureName}: ${entityName}`;
  return entityName ?? featureName ?? "Unknown point";
};

const labelFor = (
  entityKey: string,
  tags: Readonly<Record<string, string>>,
  feature: ResolvedFeature | null,
  coordinate: MapCoordinate,
  zoom: number,
  locale: string,
): LabelCandidate | null => {
  const definition = feature?.viewer?.label;
  if (!definition || zoom < definition.minZoom) return null;
  const text = resolveTaggedText(tags, definition.tag, locale);
  if (!text) return null;
  const width = labelWidth(text);
  return {
    key: entityKey,
    coordinate,
    text,
    displayText: labelDisplayText(text, width),
    priority: definition.collisionPriority,
    width,
  };
};

export const labelsWithoutCollisions = (
  candidates: readonly LabelCandidate[],
  context?: LabelCollisionContext,
): readonly LabelCandidate[] => {
  const sorted = candidates.toSorted(
    (left, right) => right.priority - left.priority || left.key.localeCompare(right.key),
  );
  if (!context || context.mapSize[0] <= 0 || context.mapSize[1] <= 0) return sorted;

  type CollisionBox = {
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
  };
  const buckets = new Map<string, CollisionBox[]>();
  const bucketSize = 32;

  return sorted.filter((candidate) => {
    const point = context.coordinateToPixel(candidate.coordinate);
    if (!point) return false;
    const box = {
      left: point[0] - candidate.width / 2,
      right: point[0] + candidate.width / 2,
      top: point[1] - 36,
      bottom: point[1] - 12,
    };
    if (
      box.right < 0 ||
      box.left > context.mapSize[0] ||
      box.bottom < 0 ||
      box.top > context.mapSize[1]
    ) {
      return false;
    }

    const bucketKeys: string[] = [];
    for (
      let x = Math.floor(box.left / bucketSize);
      x <= Math.floor(box.right / bucketSize);
      x += 1
    ) {
      for (
        let y = Math.floor(box.top / bucketSize);
        y <= Math.floor(box.bottom / bucketSize);
        y += 1
      ) {
        bucketKeys.push(`${x}:${y}`);
      }
    }
    const nearby = new Set(bucketKeys.flatMap((key) => buckets.get(key) ?? []));
    if (
      [...nearby].some(
        (placed) =>
          box.left < placed.right &&
          box.right > placed.left &&
          box.top < placed.bottom &&
          box.bottom > placed.top,
      )
    ) {
      return false;
    }
    for (const key of bucketKeys) {
      const bucket = buckets.get(key) ?? [];
      bucket.push(box);
      buckets.set(key, bucket);
    }
    return true;
  });
};

export const projectViewport = (
  snapshot: Viewport,
  bbox: BBox,
  zoom: number,
  locale: string,
  featureRegistry: FeatureRegistry = defaultFeatureRegistry,
  collisionContext?: LabelCollisionContext,
): ProjectedViewport => {
  const polygons: RenderPath[] = [];
  const polylines: RenderPath[] = [];
  const markers: RenderNode[] = [];
  const labels: LabelCandidate[] = [];
  const visibleNodes = snapshot.nodes.filter((node) => node.deletedAt === null);
  const visibleWays = snapshot.ways.filter((way) => way.deletedAt === null);
  const nodesById = new Map(visibleNodes.map((node) => [node.id, node]));
  const wayNodesByWayId = new Map<number, Viewport["wayNodes"]>();
  const usedNodeIds = new Set<number>();

  for (const wayNode of snapshot.wayNodes) {
    const current = wayNodesByWayId.get(wayNode.wayId) ?? [];
    current.push(wayNode);
    wayNodesByWayId.set(wayNode.wayId, current);
  }

  for (const way of visibleWays) {
    const coordinates = (wayNodesByWayId.get(way.id) ?? [])
      .toSorted((left, right) => left.seq - right.seq)
      .flatMap((wayNode) => {
        const node = nodesById.get(wayNode.nodeId);
        if (!node) return [];
        usedNodeIds.add(node.id);
        return [worldToMapCoordinate(node.geom)];
      });
    if (way.geometryKind === "area" ? coordinates.length < 3 : coordinates.length < 2) continue;

    const feature = featureRegistry.resolve({ kind: way.geometryKind, tags: way.tags }).primary;
    const featureVisible = !feature?.viewer || zoom >= feature.viewer.minZoom;
    if (way.geometryKind !== "area" && !featureVisible) continue;
    const coordinate = anchorForPath(coordinates, way.geometryKind);
    const closedCoordinates =
      way.geometryKind === "area" &&
      (coordinates.at(-1)?.[0] !== coordinates[0]?.[0] ||
        coordinates.at(-1)?.[1] !== coordinates[0]?.[1])
        ? [...coordinates, coordinates[0]!]
        : coordinates;
    const path: RenderPath = {
      id: way.id,
      geometryKind: way.geometryKind,
      coordinates: closedCoordinates,
      coordinate,
      feature,
      featureVisible,
      accessibleName: pathAccessibleName(
        way.geometryKind,
        way.tags,
        feature,
        featureRegistry,
        locale,
      ),
    };
    if (way.geometryKind === "area") polygons.push(path);
    else polylines.push(path);

    const label = labelFor(`way-${way.id}`, way.tags, feature, coordinate, zoom, locale);
    if (label) labels.push(label);
  }

  for (const node of visibleNodes) {
    if (
      node.geom.x < bbox[0] ||
      node.geom.x > bbox[2] ||
      node.geom.z < bbox[1] ||
      node.geom.z > bbox[3]
    ) {
      continue;
    }
    const feature = featureRegistry.resolve({ kind: "node", tags: node.tags }).primary;
    if (usedNodeIds.has(node.id) && !feature) continue;
    if (feature?.viewer && zoom < feature.viewer.minZoom) continue;
    const coordinate = worldToMapCoordinate(node.geom);
    markers.push({
      id: node.id,
      coordinate,
      feature,
      accessibleName: nodeAccessibleName(node.tags, feature, featureRegistry, locale),
    });
    const label = labelFor(`node-${node.id}`, node.tags, feature, coordinate, zoom, locale);
    if (label) labels.push(label);
  }

  return {
    polygons,
    polylines,
    markers,
    labels: labelsWithoutCollisions(labels, collisionContext),
  };
};
