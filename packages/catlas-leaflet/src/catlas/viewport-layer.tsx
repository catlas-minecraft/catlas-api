import { resolveLocalizedText, resolveTaggedText } from "@catlas/features/localization";
import { useQuery } from "@tanstack/react-query";
import { divIcon, type LatLngTuple, type Map as LeafletMap } from "leaflet";
import { useCallback, useMemo, useState } from "react";
import { useLeaflet } from "../leaflet/context/map.ts";
import { useLeafletMapEvent } from "../leaflet/hooks/useLeafletEvent.ts";
import { LayerGroup } from "../leaflet/layer/layer-group.tsx";
import { Marker } from "../leaflet/layer/marker.tsx";
import { CircleMarker } from "../leaflet/layer/path/circle-marker.tsx";
import { Polygon } from "../leaflet/layer/path/polygon.tsx";
import { Polyline } from "../leaflet/layer/path/polyline.tsx";
import { areaInteriorAnchor } from "./feature-geometry.ts";

type Point3D = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

type NodeSnapshot = {
  readonly id: number;
  readonly geom: Point3D;
  readonly tags: Record<string, string>;
  readonly deletedAt: string | null;
};

type WaySnapshot = {
  readonly id: number;
  readonly geometryKind: "line" | "area";
  readonly tags: Record<string, string>;
  readonly deletedAt: string | null;
};

type WayNodeSnapshot = {
  readonly wayId: number;
  readonly nodeId: number;
  readonly seq: number;
};

type ViewportSnapshot = {
  readonly nodes: NodeSnapshot[];
  readonly ways: WaySnapshot[];
  readonly wayNodes: WayNodeSnapshot[];
};

export type ViewportLayerProps = {
  readonly featureRegistry: ViewportFeatureRegistry;
  readonly locale?: string;
  readonly url: string | URL;
};

export type ViewportFeature = {
  readonly displayName: Readonly<Record<string, string>>;
  readonly viewer?: {
    readonly icon?: string;
    readonly label?: {
      readonly collisionPriority: number;
      readonly minZoom: number;
      readonly tag: string;
    };
    readonly minZoom: number;
  };
};

export type ViewportFeatureRegistry = {
  readonly document: { readonly defaultLocale: string };
  readonly resolve: (subject: {
    readonly kind: "node" | "line" | "area";
    readonly tags: Readonly<Record<string, string>>;
  }) => { readonly primary: ViewportFeature | null };
};

type ViewState = {
  readonly bbox: readonly [number, number, number, number];
  readonly zoom: number;
};

type ResolvedPath = {
  readonly accessibleName: string;
  readonly coordinate: LatLngTuple;
  readonly coordinates: readonly LatLngTuple[];
  readonly feature: ViewportFeature | null;
  readonly featureVisible: boolean;
  readonly id: number;
};

type ResolvedMarker = {
  readonly accessibleName: string;
  readonly coordinate: LatLngTuple;
  readonly feature: ViewportFeature | null;
  readonly id: number;
};

type LabelCandidate = {
  readonly key: string;
  readonly coordinate: LatLngTuple;
  readonly text: string;
  readonly priority: number;
  readonly width: number;
};

const ICON_PATHS: Readonly<Record<string, string>> = {
  base: '<path d="M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z"/>',
  chest: '<path d="M4 7h16v12H4zM4 11h16M10 11v3h4v-3M6 7V5h12v2"/>',
  "automatic-storage":
    '<path d="M4 6h7v6H4zM13 12h7v6h-7zM15 5h4v4M19 5l-5 5M9 19H5v-4M5 19l5-5"/>',
  farm: '<path d="M4 5h16M4 10h16M4 15h16M4 20h16M7 5v15M12 5v15M17 5v15"/>',
  "nether-portal": '<path d="M6 3h12v18H6zM9 6h6v12H9zM10.5 8.5l3 3-3 3"/>',
  "tree-farm": '<path d="m12 4-7 9h4l-3 4h12l-3-4h4zM12 17v4"/>',
};

const formatView = (map: LeafletMap): ViewState => {
  const bounds = map.getBounds();
  return {
    bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
    zoom: map.getZoom(),
  };
};

const toLatLng = (geom: Point3D): LatLngTuple => [geom.z, geom.x];

const iconForFeature = (iconId: string) => {
  const path = ICON_PATHS[iconId];
  if (!path) return null;
  return divIcon({
    className: "catlas-feature-icon-wrapper",
    html: `<span aria-hidden="true" class="catlas-feature-icon"><svg viewBox="0 0 24 24">${path}</svg></span>`,
    iconAnchor: [14, 14],
    iconSize: [28, 28],
  });
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const iconForLabel = (label: LabelCandidate) =>
  divIcon({
    className: "catlas-feature-label-wrapper",
    html: `<span aria-hidden="true" class="catlas-feature-label">${escapeHtml(label.text)}</span>`,
    iconAnchor: [label.width / 2, 36],
    iconSize: [label.width, 24],
  });

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const labelWidth = (text: string) => {
  let units = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    units += (segment.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
  }
  return Math.min(240, Math.max(48, units * 7 + 16));
};

const labelsWithoutCollisions = (map: LeafletMap, candidates: readonly LabelCandidate[]) => {
  type CollisionBox = {
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
  };
  const buckets = new Map<string, CollisionBox[]>();
  const mapSize = map.getSize();
  const bucketSize = 32;
  return candidates
    .toSorted((left, right) => right.priority - left.priority || left.key.localeCompare(right.key))
    .filter((candidate) => {
      const point = map.latLngToContainerPoint(candidate.coordinate);
      const box = {
        left: point.x - candidate.width / 2,
        right: point.x + candidate.width / 2,
        top: point.y - 36,
        bottom: point.y - 12,
      };
      if (box.right < 0 || box.left > mapSize.x || box.bottom < 0 || box.top > mapSize.y) {
        return false;
      }

      const bucketKeys: string[] = [];
      for (
        let x = Math.floor(box.left / bucketSize);
        x <= Math.floor(box.right / bucketSize);
        x++
      ) {
        for (
          let y = Math.floor(box.top / bucketSize);
          y <= Math.floor(box.bottom / bucketSize);
          y++
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

const anchorForPath = (
  coordinates: readonly LatLngTuple[],
  geometryKind: WaySnapshot["geometryKind"],
): LatLngTuple => {
  if (geometryKind === "area") {
    return areaInteriorAnchor(coordinates);
  }

  const lengths = coordinates.slice(1).map(([lat, lng], index) => {
    const previous = coordinates[index]!;
    return Math.hypot(lat - previous[0], lng - previous[1]);
  });
  const halfway = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!;
    if (traversed + length >= halfway) {
      const start = coordinates[index]!;
      const end = coordinates[index + 1]!;
      const ratio = length === 0 ? 0 : (halfway - traversed) / length;
      return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
    }
    traversed += length;
  }
  return coordinates[0]!;
};

const accessibleNameFor = (
  kind: "point" | "line" | "area",
  tags: Readonly<Record<string, string>>,
  feature: ViewportFeature | null,
  registry: ViewportFeatureRegistry,
  locale: string | undefined,
) => {
  const featureName = feature
    ? resolveLocalizedText(feature.displayName, locale, registry.document.defaultLocale)
    : null;
  const nameTag = feature?.viewer?.label?.tag ?? "name";
  const entityName = resolveTaggedText(tags, nameTag, locale);
  if (featureName && entityName) return `${featureName}: ${entityName}`;
  return entityName ?? featureName ?? `Unknown ${kind}`;
};

const labelFor = (
  entityKey: string,
  tags: Readonly<Record<string, string>>,
  feature: ViewportFeature | null,
  coordinate: LatLngTuple,
  zoom: number,
  locale: string | undefined,
): LabelCandidate | null => {
  const definition = feature?.viewer?.label;
  if (!definition || zoom < definition.minZoom) return null;
  const text = resolveTaggedText(tags, definition.tag, locale);
  if (!text) return null;
  return {
    key: entityKey,
    coordinate,
    text,
    priority: definition.collisionPriority,
    width: labelWidth(text),
  };
};

export const ViewportLayer = (props: ViewportLayerProps) => {
  return (
    <LayerGroup>
      <ViewportLayerInner {...props} />
    </LayerGroup>
  );
};

const ViewportLayerInner = ({
  featureRegistry,
  locale = navigator.language,
  url,
}: ViewportLayerProps) => {
  const { map } = useLeaflet();
  const [view, setView] = useState<ViewState>(() => formatView(map));

  const snapshot = useQuery({
    queryKey: ["viewport", String(url), view.bbox],
    queryFn: async () => {
      const parsedUrl = new URL(url, window.location.href);
      parsedUrl.searchParams.set("bbox", view.bbox.join(","));
      const response = await fetch(parsedUrl);
      if (!response.ok) throw new Error(`Viewport request failed: ${response.status}`);
      return (await response.json()) as ViewportSnapshot;
    },
    placeholderData: (previousData) => previousData,
  });

  const handleViewChange = useCallback(() => setView(formatView(map)), [map]);

  useLeafletMapEvent(
    {
      moveend: handleViewChange,
      resize: handleViewChange,
      zoomend: handleViewChange,
    },
    [handleViewChange],
  );

  const layers = useMemo(() => {
    const polygons: ResolvedPath[] = [];
    const polylines: ResolvedPath[] = [];
    const markers: ResolvedMarker[] = [];
    const labels: LabelCandidate[] = [];
    if (!snapshot.data) return { polygons, polylines, markers, labels };

    const visibleNodes = snapshot.data.nodes.filter((node) => node.deletedAt === null);
    const visibleWays = snapshot.data.ways.filter((way) => way.deletedAt === null);
    const nodesById = new Map(visibleNodes.map((node) => [node.id, node]));
    const wayNodesByWayId = new Map<number, WayNodeSnapshot[]>();
    const usedNodeIds = new Set<number>();

    for (const wayNode of snapshot.data.wayNodes) {
      const current = wayNodesByWayId.get(wayNode.wayId) ?? [];
      current.push(wayNode);
      wayNodesByWayId.set(wayNode.wayId, current);
    }

    for (const way of visibleWays) {
      const coordinates = (wayNodesByWayId.get(way.id) ?? [])
        .sort((left, right) => left.seq - right.seq)
        .flatMap((wayNode) => {
          const node = nodesById.get(wayNode.nodeId);
          if (!node) return [];
          usedNodeIds.add(node.id);
          return [toLatLng(node.geom)];
        });
      if (coordinates.length < 2) continue;

      const feature = featureRegistry.resolve({ kind: way.geometryKind, tags: way.tags }).primary;
      const featureVisible = !feature?.viewer || view.zoom >= feature.viewer.minZoom;
      if (way.geometryKind !== "area" && !featureVisible) continue;
      const coordinate = anchorForPath(coordinates, way.geometryKind);
      const path = {
        id: way.id,
        coordinates,
        coordinate,
        feature,
        featureVisible,
        accessibleName: accessibleNameFor(
          way.geometryKind,
          way.tags,
          feature,
          featureRegistry,
          locale,
        ),
      };
      if (way.geometryKind === "area" && coordinates.length >= 3) polygons.push(path);
      else polylines.push(path);

      const label = labelFor(`way-${way.id}`, way.tags, feature, coordinate, view.zoom, locale);
      if (label) labels.push(label);
    }

    for (const node of visibleNodes) {
      const [west, south, east, north] = view.bbox;
      if (node.geom.x < west || node.geom.x > east || node.geom.z < south || node.geom.z > north) {
        continue;
      }
      const feature = featureRegistry.resolve({ kind: "node", tags: node.tags }).primary;
      if (usedNodeIds.has(node.id) && !feature) continue;
      if (feature?.viewer && view.zoom < feature.viewer.minZoom) continue;
      const coordinate = toLatLng(node.geom);
      markers.push({
        id: node.id,
        coordinate,
        feature,
        accessibleName: accessibleNameFor("point", node.tags, feature, featureRegistry, locale),
      });
      const label = labelFor(`node-${node.id}`, node.tags, feature, coordinate, view.zoom, locale);
      if (label) labels.push(label);
    }

    return { polygons, polylines, markers, labels: labelsWithoutCollisions(map, labels) };
  }, [featureRegistry, locale, map, snapshot.data, view.bbox, view.zoom]);

  return (
    <>
      {layers.polygons.map(({ id, coordinates }) => (
        <Polygon
          key={`polygon-${id}`}
          positions={[...coordinates]}
          color="#f97316"
          weight={2}
          fillColor="#fb923c"
          fillOpacity={0.2}
        />
      ))}
      {layers.polylines.map(({ id, coordinates }) => (
        <Polyline
          key={`polyline-${id}`}
          positions={[...coordinates]}
          color="#f97316"
          weight={3}
          opacity={0.95}
        />
      ))}
      {layers.polygons
        .concat(layers.polylines)
        .map(({ id, coordinate, feature, featureVisible }) => {
          if (!featureVisible) return null;

          const iconId = feature?.viewer?.icon;
          const icon = iconId ? iconForFeature(iconId) : null;
          return icon ? (
            <Marker
              key={`path-marker-${id}-${iconId}`}
              icon={icon}
              interactive={false}
              keyboard={false}
              position={coordinate}
            />
          ) : null;
        })}
      {layers.markers.map(({ id, coordinate, feature }) => {
        const iconId = feature?.viewer?.icon;
        const icon = iconId ? iconForFeature(iconId) : null;
        return icon ? (
          <Marker
            key={`marker-${id}-${iconId}`}
            icon={icon}
            interactive={false}
            keyboard={false}
            position={coordinate}
          />
        ) : (
          <CircleMarker
            key={`marker-${id}`}
            position={coordinate}
            radius={5}
            color="#0f172a"
            weight={1}
            fillColor="#22c55e"
            fillOpacity={0.95}
          />
        );
      })}
      {layers.labels.map((label) => (
        <Marker
          key={`label-${label.key}-${label.text}`}
          icon={iconForLabel(label)}
          interactive={false}
          keyboard={false}
          position={label.coordinate}
          zIndexOffset={label.priority}
        />
      ))}
      <section aria-label="Visible map features" className="catlas-map-summary">
        <ul>
          {layers.polygons.concat(layers.polylines).map((path) => (
            <li key={`summary-path-${path.id}`}>{path.accessibleName}</li>
          ))}
          {layers.markers.map((marker) => (
            <li key={`summary-node-${marker.id}`}>{marker.accessibleName}</li>
          ))}
        </ul>
      </section>
    </>
  );
};
