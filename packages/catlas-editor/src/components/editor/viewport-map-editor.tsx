import type { ViewportSnapshot } from "@catlas/domain";
import { useLeaflet, useLeafletMapEvent } from "@catlas/leaflet";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapEditor, type EditorChanges } from "@/lib/editor/editor";
import type { SelectedEntity } from "@/lib/editor/viewport-projector";

type ViewportMapEditorProps = {
  interactionMode?: "browse" | "add-node" | "add-way" | "add-area";
  onStatusChange?: (status: {
    bbox: readonly [number, number, number, number];
    isFetching: boolean;
    error: string | null;
    selectedEntity: SelectedEntity;
    changes: EditorChanges;
    wayCreation: {
      id: number;
      geometryKind: "line" | "area";
      vertexCount: number;
    } | null;
  }) => void;
  onRerenderReady?: (rerender: (() => void) | null) => void;
  onWayCreationReady?: (controls: { finish: () => void; cancel: () => void } | null) => void;
};

const formatBbox = (map: L.Map) => {
  const bounds = map.getBounds();
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] as const;
};

const fetchViewport = async (bbox: readonly [number, number, number, number]) => {
  const parsedUrl = new URL("/viewport", window.location.href);
  parsedUrl.searchParams.set("bbox", bbox.join(","));

  const response = await fetch(parsedUrl, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Viewport request failed: ${response.status}`);
  }

  return (await response.json()) as ViewportSnapshot;
};

export const ViewportMapEditor = ({
  interactionMode = "browse",
  onStatusChange,
  onRerenderReady,
  onWayCreationReady,
}: ViewportMapEditorProps) => {
  const { map } = useLeaflet();
  const editorRef = useRef<MapEditor | null>(null);
  const interactionModeRef = useRef(interactionMode);
  const [bbox, setBbox] = useState<readonly [number, number, number, number]>(() =>
    formatBbox(map),
  );
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity>(null);
  const [changes, setChanges] = useState<EditorChanges>({
    dirtyNodes: [],
    dirtyWays: [],
  });

  interactionModeRef.current = interactionMode;

  useEffect(() => {
    const editor = new MapEditor(map, {
      onSelectionChange: setSelectedEntity,
      onChangesChange: setChanges,
      getInteractionMode: () => interactionModeRef.current,
    });
    editorRef.current = editor;
    onRerenderReady?.(() => editor.rerender());
    onWayCreationReady?.({
      finish: () => editor.finishWayCreation(),
      cancel: () => editor.cancelWayCreation(),
    });

    return () => {
      onRerenderReady?.(null);
      onWayCreationReady?.(null);
      editor.destroy();
      editorRef.current = null;
    };
  }, [map, onRerenderReady, onWayCreationReady]);

  useLeafletMapEvent(
    {
      click: (event) => {
        if (interactionMode === "add-node") {
          editorRef.current?.createNodeAt({
            x: event.latlng.lng,
            z: event.latlng.lat,
          });
          return;
        }

        if (interactionMode === "add-way") {
          editorRef.current?.addWayVertexAt(
            {
              x: event.latlng.lng,
              z: event.latlng.lat,
            },
            "line",
          );
          return;
        }

        if (interactionMode === "add-area") {
          editorRef.current?.addWayVertexAt(
            {
              x: event.latlng.lng,
              z: event.latlng.lat,
            },
            "area",
          );
          return;
        }

        editorRef.current?.clearSelection();
      },
      moveend: () => {
        setBbox(formatBbox(map));
      },
      resize: () => {
        setBbox(formatBbox(map));
      },
    },
    [interactionMode, map],
  );

  const viewportQuery = useQuery({
    queryKey: ["editor-viewport", bbox],
    queryFn: () => fetchViewport(bbox),
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    if (!viewportQuery.data || !editorRef.current) {
      return;
    }

    editorRef.current.patchViewportData(viewportQuery.data);
  }, [viewportQuery.data]);

  const status = useMemo(
    () => ({
      bbox,
      isFetching: viewportQuery.isFetching,
      error: viewportQuery.error instanceof Error ? viewportQuery.error.message : null,
      selectedEntity,
      changes,
      wayCreation: editorRef.current?.getWayCreationState() ?? null,
    }),
    [bbox, changes, selectedEntity, viewportQuery.error, viewportQuery.isFetching],
  );

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  return null;
};
