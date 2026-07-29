import { useLeaflet } from "../leaflet/context/map.ts";
import { type LatLngTuple } from "leaflet";
import { useCallback, useMemo, useState } from "react";
import { useLeafletMapEvent } from "../leaflet/hooks/useLeafletEvent.ts";
import { useQuery } from "@tanstack/react-query";

import { LayerGroup } from "../leaflet/layer/layer-group.tsx";
import { CircleMarker } from "../leaflet/layer/path/circle-marker.tsx";
import { Polygon } from "../leaflet/layer/path/polygon.tsx";
import { Polyline } from "../leaflet/layer/path/polyline.tsx";

type Point3D = {
  x: number;
  y: number;
  z: number;
};

type NodeSnapshot = {
  id: number;
  geom: Point3D;
  featureType: string;
  tags: Record<string, string>;
  deletedAt: number | null;
};

type WaySnapshot = {
  id: number;
  featureType: string;
  geometryKind: "line" | "area";
  isClosed: boolean;
  tags: Record<string, string>;
  deletedAt: number | null;
};

type WayNodeSnapshot = {
  id: number;
  wayId: number;
  nodeId: number;
  seq: number;
};

type RelationSnapshot = {
  id: number;
  deletedAt: number | null;
};

type ViewportSnapshot = {
  nodes: NodeSnapshot[];
  ways: WaySnapshot[];
  wayNodes: WayNodeSnapshot[];
  relations: RelationSnapshot[];
};

type ViewportLayerProps = {
  includeRelations?: boolean;
  url?: string | URL;
};

const formatBbox = (map: L.Map) => {
  const bounds = map.getBounds();
  const minX = bounds.getWest();
  const minZ = bounds.getSouth();
  const maxX = bounds.getEast();
  const maxZ = bounds.getNorth();

  return [minX, minZ, maxX, maxZ] as const;
};

const toLatLng = (geom: Point3D): LatLngTuple => [geom.z, geom.x];

export const ViewportLayer = (props: ViewportLayerProps) => {
  return (
    <LayerGroup>
      <ViewportLayerInner {...props} />
    </LayerGroup>
  );
};

const ViewportLayerInner = ({
  includeRelations = false,
  url = "/api/viewport",
}: ViewportLayerProps) => {
  const { map } = useLeaflet();
  const [currentBbox, setCurrentBbox] = useState<readonly [number, number, number, number]>(() =>
    formatBbox(map),
  );

  const snapshot = useQuery({
    queryKey: ["viewport", currentBbox],
    queryFn: async () => {
      const parsedUrl = new URL(url, window.location.href);
      parsedUrl.searchParams.set("bbox", currentBbox.join(","));

      if (includeRelations) {
        parsedUrl.searchParams.set("includeRelations", "true");
      }

      const response = await fetch(parsedUrl);

      if (!response.ok) {
        throw new Error(`Viewport request failed: ${response.status}`);
      }

      return (await response.json()) as ViewportSnapshot;
    },
    placeholderData: (previousData) => previousData,
  });

  const handleChangeBbox = useCallback(() => {
    const bbox = formatBbox(map);
    setCurrentBbox(bbox);
  }, [map]);

  useLeafletMapEvent(
    {
      moveend: handleChangeBbox,
      resize: handleChangeBbox,
    },
    [handleChangeBbox],
  );

  const layers = useMemo(() => {
    const layers: {
      polygons: {
        id: number;
        coordinates: LatLngTuple[];
      }[];
      polylines: {
        id: number;
        coordinates: LatLngTuple[];
      }[];
      markers: {
        id: number;
        coordinate: LatLngTuple;
      }[];
    } = {
      polygons: [],
      polylines: [],
      markers: [],
    };
    if (!snapshot.data) {
      return layers;
    }

    const snapshotData = snapshot.data;

    const visibleNodes = snapshotData.nodes.filter((node) => node.deletedAt === null);
    const visibleWays = snapshotData.ways.filter((way) => way.deletedAt === null);

    const nodesById = new Map(visibleNodes.map((node) => [node.id, node]));
    const wayNodesByWayId = new Map<number, WayNodeSnapshot[]>();
    const usedNodeIds = new Set<number>();

    for (const wayNode of snapshotData.wayNodes) {
      const current = wayNodesByWayId.get(wayNode.wayId) ?? [];
      current.push(wayNode);
      wayNodesByWayId.set(wayNode.wayId, current);
    }

    for (const way of visibleWays) {
      const orderedWayNodes = (wayNodesByWayId.get(way.id) ?? []).sort((a, b) => a.seq - b.seq);
      const coordinates = orderedWayNodes.flatMap((wayNode) => {
        const node = nodesById.get(wayNode.nodeId);

        if (!node) {
          return [];
        }

        usedNodeIds.add(node.id);
        return [toLatLng(node.geom)];
      });

      if (coordinates.length < 2) {
        continue;
      }

      if (way.geometryKind === "area" && coordinates.length >= 3) {
        layers.polygons.push({
          id: way.id,
          coordinates,
        });
      } else {
        layers.polylines.push({
          id: way.id,
          coordinates,
        });
      }
    }

    for (const node of visibleNodes) {
      layers.markers.push({
        id: node.id,
        coordinate: toLatLng(node.geom),
      });
    }

    return layers;
  }, [snapshot.data]);

  return (
    <>
      {layers.polygons.map(({ id, coordinates }) => (
        <Polygon
          key={`polygon-${id}`}
          positions={coordinates}
          color={"#f97316"}
          weight={2}
          fillColor="#fb923c"
          fillOpacity={0.2}
        />
      ))}
      {layers.polylines.map(({ id, coordinates }) => (
        <Polyline
          key={`polyline-${id}`}
          positions={coordinates}
          color={"#f97316"}
          weight={3}
          opacity={0.95}
        />
      ))}
      {layers.markers.map(({ id, coordinate }) => (
        <CircleMarker
          key={`marker-${id}`}
          position={coordinate}
          radius={5}
          color={"#0f172a"}
          weight={1}
          fillColor={"#22c55e"}
          fillOpacity={0.95}
        />
      ))}
    </>
  );
};
