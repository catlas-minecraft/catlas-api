import type { NodeSnapshot, ViewportSnapshot, WaySnapshot } from "@catlas/domain";
import type { Map as LeafletMap } from "leaflet";
import { LeafletViewportStore } from "./leaflet-viewport-store";
import type { SelectedEntity } from "./viewport-projector";
import { normalizeViewportData, type NormalizedViewportData, type RenderedWay } from "./viewport-normalizer";

export type EditorChanges = {
  dirtyNodes: Array<{
    id: number;
    isNew: boolean;
    x: number;
    z: number;
  }>;
  dirtyWays: Array<{
    id: number;
    isNew: boolean;
    geometryKind: "line" | "area";
    nodeIds: number[];
  }>;
};

type NodeCoordinate = {
  x: number;
  y: number;
  z: number;
};

type ActiveNodeDrag = {
  id: number;
  coordinate: NodeCoordinate;
};

type LocalWayDraft = {
  id: number;
  nodeIds: number[];
  ownedNodeIds: number[];
  way: WaySnapshot;
};

const createSyntheticTimestamp = () => Date.now();

const createLocalNodeSnapshot = ({
  id,
  x,
  y,
  z,
}: {
  id: number;
  x: number;
  y: number;
  z: number;
}): NodeSnapshot => ({
  id,
  geom: { x, y, z },
  featureType: "editor:new-node",
  tags: {},
  version: 0,
  createdAt: createSyntheticTimestamp(),
  updatedAt: createSyntheticTimestamp(),
  createdBy: "editor",
  updatedBy: "editor",
  deletedAt: null,
  changesetId: 0,
});

const createLocalWaySnapshot = (
  id: number,
  geometryKind: "line" | "area",
): WaySnapshot => ({
  id,
  featureType: "editor:new-way",
  geometryKind,
  isClosed: geometryKind === "area",
  tags: {},
  version: 0,
  createdAt: createSyntheticTimestamp(),
  updatedAt: createSyntheticTimestamp(),
  createdBy: "editor",
  updatedBy: "editor",
  deletedAt: null,
  changesetId: 0,
});

const sameSelection = (left: SelectedEntity, right: SelectedEntity) =>
  left?.type === right?.type && left?.id === right?.id;

const sameNodeGeometry = (left: NodeSnapshot, right: NodeSnapshot) =>
  left.geom.x === right.geom.x && left.geom.y === right.geom.y && left.geom.z === right.geom.z;

const didWayGeometryChange = (previousWay: RenderedWay, nextWay: RenderedWay) => {
  if (previousWay.kind !== nextWay.kind) {
    return true;
  }

  if (previousWay.coordinates.length !== nextWay.coordinates.length) {
    return true;
  }

  return previousWay.coordinates.some((coordinate, index) => {
    const nextCoordinate = nextWay.coordinates[index];
    return !nextCoordinate || coordinate[0] !== nextCoordinate[0] || coordinate[1] !== nextCoordinate[1];
  });
};

const applyNodeCoordinate = (node: NodeSnapshot, coordinate: NodeCoordinate): NodeSnapshot => ({
  ...node,
  geom: {
    ...node.geom,
    x: coordinate.x,
    y: coordinate.y,
    z: coordinate.z,
  },
});

const cloneRenderedWay = (renderedWay: RenderedWay): RenderedWay => ({
  ...renderedWay,
  nodeIds: [...renderedWay.nodeIds],
  coordinates: [...renderedWay.coordinates],
});

export class MapEditor {
  private serverData: NormalizedViewportData | null = null;
  private normalizedData: NormalizedViewportData | null = null;
  private selectedEntity: SelectedEntity = null;
  private visibleSelection: SelectedEntity = null;
  private readonly createdNodesById = new Map<number, NodeSnapshot>();
  private readonly createdWaysById = new Map<number, LocalWayDraft>();
  private readonly pinnedNodesById = new Map<number, NodeSnapshot>();
  private readonly pinnedWaysById = new Map<number, RenderedWay>();
  private readonly editedNodeCoordinates = new Map<number, NodeCoordinate>();
  private activeNodeDrag: ActiveNodeDrag | null = null;
  private nextLocalNodeId = -1;
  private nextLocalWayId = -1;
  private creatingWay: LocalWayDraft | null = null;
  private readonly store: LeafletViewportStore;
  private readonly onSelectionChange?: (selection: SelectedEntity) => void;
  private readonly onChangesChange?: (changes: EditorChanges) => void;
  private readonly getInteractionMode?: () => "browse" | "add-node" | "add-way" | "add-area";

  constructor(
    public readonly leafletMap: LeafletMap,
    options?: {
      onSelectionChange?: (selection: SelectedEntity) => void;
      onChangesChange?: (changes: EditorChanges) => void;
      getInteractionMode?: () => "browse" | "add-node" | "add-way" | "add-area";
    },
  ) {
    this.onSelectionChange = options?.onSelectionChange;
    this.onChangesChange = options?.onChangesChange;
    this.getInteractionMode = options?.getInteractionMode;
    this.store = new LeafletViewportStore(leafletMap, {
      onNodeSelect: (id) => this.handleNodeSelect(id),
      onWaySelect: (id) => this.selectWay(id),
      onNodeDragStart: (id) => this.startNodeDrag(id),
      onNodeDragMove: (id, coordinate) => this.moveNodeDrag(id, coordinate),
      onNodeDragEnd: (id, coordinate) => this.endNodeDrag(id, coordinate),
    });
  }

  patchViewportData(data: ViewportSnapshot) {
    const previousData = this.normalizedData;
    const nextServerData = normalizeViewportData(data);
    const nextData = this.buildDisplayData(nextServerData);
    const previousVisibleSelection = this.visibleSelection;
    const nextVisibleSelection = this.resolveSelection(nextData, this.selectedEntity);

    this.patchWaysFromViewport(
      previousData,
      nextData,
      previousVisibleSelection,
      nextVisibleSelection,
    );
    this.patchNodesFromViewport(
      previousData,
      nextData,
      previousVisibleSelection,
      nextVisibleSelection,
    );

    this.serverData = nextServerData;
    this.normalizedData = nextData;
    this.visibleSelection = nextVisibleSelection;
    this.emitChangesChange();
  }

  rerender() {
    if (!this.serverData) {
      return;
    }

    const previousData = this.normalizedData;
    const nextData = this.buildDisplayData(this.serverData);
    const previousVisibleSelection = this.visibleSelection;
    const nextVisibleSelection = this.resolveSelection(nextData, this.selectedEntity);

    this.patchWaysFromViewport(
      previousData,
      nextData,
      previousVisibleSelection,
      nextVisibleSelection,
    );
    this.patchNodesFromViewport(
      previousData,
      nextData,
      previousVisibleSelection,
      nextVisibleSelection,
    );

    this.normalizedData = nextData;
    this.visibleSelection = nextVisibleSelection;
    this.emitChangesChange();
  }

  addWayVertexAt(
    coordinate: { x: number; z: number },
    geometryKind: "line" | "area" = "line",
  ) {
    const nodeId = this.nextLocalNodeId;
    this.nextLocalNodeId -= 1;

    this.createdNodesById.set(
      nodeId,
      createLocalNodeSnapshot({
        id: nodeId,
        x: coordinate.x,
        y: 0,
        z: coordinate.z,
      }),
    );
    this.editedNodeCoordinates.set(nodeId, {
      x: coordinate.x,
      y: 0,
      z: coordinate.z,
    });

    if (!this.creatingWay) {
      const wayId = this.nextLocalWayId;
      this.nextLocalWayId -= 1;
      this.creatingWay = {
        id: wayId,
        nodeIds: [nodeId],
        ownedNodeIds: [nodeId],
        way: createLocalWaySnapshot(wayId, geometryKind),
      };
    } else {
      this.creatingWay = {
        ...this.creatingWay,
        nodeIds: [...this.creatingWay.nodeIds, nodeId],
        ownedNodeIds: [...this.creatingWay.ownedNodeIds, nodeId],
      };
    }

    const nextSelection: SelectedEntity = { type: "way", id: this.creatingWay.id };

    if (this.serverData) {
      const previousData = this.normalizedData;
      const nextData = this.buildDisplayData(this.serverData);
      const previousVisibleSelection = this.visibleSelection;

      this.patchWaysFromViewport(
        previousData,
        nextData,
        previousVisibleSelection,
        nextSelection,
      );
      this.patchNodesFromViewport(
        previousData,
        nextData,
        previousVisibleSelection,
        nextSelection,
      );

      this.normalizedData = nextData;
      this.visibleSelection = this.resolveSelection(nextData, nextSelection);
    } else {
      this.visibleSelection = nextSelection;
    }

    this.selectedEntity = nextSelection;
    this.onSelectionChange?.(nextSelection);
    this.emitChangesChange();
  }

  private addExistingNodeToWay(nodeId: number) {
    if (!this.normalizedData?.nodesById.has(nodeId)) {
      return;
    }

    this.pinNode(nodeId);

    if (!this.creatingWay) {
      const wayId = this.nextLocalWayId;
      this.nextLocalWayId -= 1;
      this.creatingWay = {
        id: wayId,
        nodeIds: [nodeId],
        ownedNodeIds: [],
        way: createLocalWaySnapshot(wayId, "line"),
      };
    } else {
      this.creatingWay = {
        ...this.creatingWay,
        nodeIds: [...this.creatingWay.nodeIds, nodeId],
      };
    }

    const nextSelection: SelectedEntity = { type: "way", id: this.creatingWay.id };

    if (this.serverData) {
      const previousData = this.normalizedData;
      const nextData = this.buildDisplayData(this.serverData);
      const previousVisibleSelection = this.visibleSelection;

      this.patchWaysFromViewport(
        previousData,
        nextData,
        previousVisibleSelection,
        nextSelection,
      );
      this.patchNodesFromViewport(
        previousData,
        nextData,
        previousVisibleSelection,
        nextSelection,
      );

      this.normalizedData = nextData;
      this.visibleSelection = this.resolveSelection(nextData, nextSelection);
    } else {
      this.visibleSelection = nextSelection;
    }

    this.selectedEntity = nextSelection;
    this.onSelectionChange?.(nextSelection);
    this.emitChangesChange();
  }

  finishWayCreation() {
    if (!this.creatingWay) {
      return;
    }

    const minimumVertices = this.creatingWay.way.geometryKind === "area" ? 3 : 2;

    if (this.creatingWay.nodeIds.length < minimumVertices) {
      this.cancelWayCreation();
      return;
    }

    this.createdWaysById.set(this.creatingWay.id, this.creatingWay);
    this.creatingWay = null;

    if (this.serverData) {
      const previousData = this.normalizedData;
      const nextData = this.buildDisplayData(this.serverData);
      const previousVisibleSelection = this.visibleSelection;
      const nextVisibleSelection = this.resolveSelection(nextData, this.selectedEntity);

      this.patchWaysFromViewport(
        previousData,
        nextData,
        previousVisibleSelection,
        nextVisibleSelection,
      );
      this.patchNodesFromViewport(
        previousData,
        nextData,
        previousVisibleSelection,
        nextVisibleSelection,
      );

      this.normalizedData = nextData;
      this.visibleSelection = nextVisibleSelection;
    }

    this.emitChangesChange();
  }

  cancelWayCreation() {
    if (!this.creatingWay) {
      return;
    }

    for (const nodeId of this.creatingWay.ownedNodeIds) {
      this.createdNodesById.delete(nodeId);
      this.editedNodeCoordinates.delete(nodeId);
    }

    this.creatingWay = null;

    if (this.serverData) {
      const previousData = this.normalizedData;
      const nextData = this.buildDisplayData(this.serverData);
      const previousVisibleSelection = this.visibleSelection;
      const nextVisibleSelection = this.resolveSelection(nextData, this.selectedEntity);

      this.patchWaysFromViewport(
        previousData,
        nextData,
        previousVisibleSelection,
        nextVisibleSelection,
      );
      this.patchNodesFromViewport(
        previousData,
        nextData,
        previousVisibleSelection,
        nextVisibleSelection,
      );

      this.normalizedData = nextData;
      this.visibleSelection = nextVisibleSelection;
    }

    if (this.selectedEntity?.type === "way" && this.selectedEntity.id < 0) {
      this.selectedEntity = null;
      this.visibleSelection = null;
      this.onSelectionChange?.(null);
    }

    this.emitChangesChange();
  }

  getWayCreationState() {
    return this.creatingWay
      ? {
          id: this.creatingWay.id,
          geometryKind: this.creatingWay.way.geometryKind,
          vertexCount: this.creatingWay.nodeIds.length,
        }
      : null;
  }

  createNodeAt(coordinate: { x: number; z: number }) {
    const nodeId = this.nextLocalNodeId;
    this.nextLocalNodeId -= 1;

    this.createdNodesById.set(
      nodeId,
      createLocalNodeSnapshot({
        id: nodeId,
        x: coordinate.x,
        y: 0,
        z: coordinate.z,
      }),
    );
    this.editedNodeCoordinates.set(nodeId, {
      x: coordinate.x,
      y: 0,
      z: coordinate.z,
    });

    const nextSelection: SelectedEntity = { type: "node", id: nodeId };

    if (this.serverData) {
      const previousData = this.normalizedData;
      const nextData = this.buildDisplayData(this.serverData);
      const previousVisibleSelection = this.visibleSelection;

      this.patchWaysFromViewport(
        previousData,
        nextData,
        previousVisibleSelection,
        nextSelection,
      );
      this.patchNodesFromViewport(
        previousData,
        nextData,
        previousVisibleSelection,
        nextSelection,
      );

      this.normalizedData = nextData;
      this.visibleSelection = nextSelection;
    } else {
      this.visibleSelection = nextSelection;
    }

    this.selectedEntity = nextSelection;
    this.onSelectionChange?.(nextSelection);
    this.emitChangesChange();
  }

  private handleNodeSelect(id: number) {
    const interactionMode = this.getInteractionMode?.() ?? "browse";
    const lastCreatedNodeId = this.creatingWay?.nodeIds.at(-1) ?? null;

    if ((interactionMode === "add-way" || interactionMode === "add-area") && lastCreatedNodeId === id) {
      this.finishWayCreation();
      return;
    }

    if (interactionMode === "add-way") {
      this.addExistingNodeToWay(id);
      return;
    }

    this.selectNode(id);
  }

  selectNode(id: number) {
    if (!this.normalizedData || !this.normalizedData.nodesById.has(id)) {
      return;
    }

    const nextSelection: SelectedEntity = { type: "node", id };

    if (sameSelection(this.selectedEntity, nextSelection)) {
      return;
    }

    const previousVisibleSelection = this.visibleSelection;
    this.selectedEntity = nextSelection;
    this.visibleSelection = nextSelection;
    this.patchSelectionChange(previousVisibleSelection, nextSelection);
    this.onSelectionChange?.(nextSelection);
  }

  selectWay(id: number) {
    if (!this.normalizedData || !this.normalizedData.renderedWays.has(id)) {
      return;
    }

    const nextSelection: SelectedEntity = { type: "way", id };

    if (sameSelection(this.selectedEntity, nextSelection)) {
      return;
    }

    const previousVisibleSelection = this.visibleSelection;
    this.selectedEntity = nextSelection;
    this.visibleSelection = nextSelection;
    this.patchSelectionChange(previousVisibleSelection, nextSelection);
    this.onSelectionChange?.(nextSelection);
  }

  clearSelection() {
    if (!this.selectedEntity) {
      return;
    }

    const previousVisibleSelection = this.visibleSelection;
    this.selectedEntity = null;
    this.visibleSelection = null;
    this.patchSelectionChange(previousVisibleSelection, null);
    this.onSelectionChange?.(null);
  }

  getSelectedEntity() {
    return this.selectedEntity;
  }

  destroy() {
    this.store.destroy();
    this.serverData = null;
    this.normalizedData = null;
    this.selectedEntity = null;
    this.visibleSelection = null;
    this.activeNodeDrag = null;
    this.createdNodesById.clear();
    this.createdWaysById.clear();
    this.creatingWay = null;
    this.pinnedNodesById.clear();
    this.pinnedWaysById.clear();
    this.editedNodeCoordinates.clear();
    this.emitChangesChange();
  }

  private getChanges(): EditorChanges {
    const dirtyNodeCoordinates = new Map(this.editedNodeCoordinates);

    if (this.activeNodeDrag) {
      dirtyNodeCoordinates.set(this.activeNodeDrag.id, this.activeNodeDrag.coordinate);
    }

    const dirtyNodes = [...dirtyNodeCoordinates.entries()]
      .sort(([leftId], [rightId]) => leftId - rightId)
      .map(([id, coordinate]) => ({
        id,
        isNew: this.createdNodesById.has(id),
        x: coordinate.x,
        z: coordinate.z,
      }));

    const dirtyWayIds = new Set<number>();

    for (const nodeId of dirtyNodeCoordinates.keys()) {
      const serverWayIds = this.serverData?.wayIdsByNodeId.get(nodeId) ?? [];
      const visibleWayIds = this.normalizedData?.wayIdsByNodeId.get(nodeId) ?? [];

      for (const wayId of serverWayIds) {
        dirtyWayIds.add(wayId);
      }

      for (const wayId of visibleWayIds) {
        dirtyWayIds.add(wayId);
      }
    }

    const dirtyWays = [...dirtyWayIds]
      .sort((leftId, rightId) => leftId - rightId)
      .map((id) => {
        const renderedWay =
          this.normalizedData?.renderedWays.get(id) ??
          this.serverData?.renderedWays.get(id) ??
          this.pinnedWaysById.get(id);
        const localWay = this.createdWaysById.get(id) ?? (this.creatingWay?.id === id ? this.creatingWay : null);

        return {
          id,
          isNew: this.createdWaysById.has(id) || this.creatingWay?.id === id,
          geometryKind: localWay?.way.geometryKind ?? renderedWay?.way.geometryKind ?? "line",
          nodeIds: renderedWay ? [...renderedWay.nodeIds] : [],
        };
      });

    return {
      dirtyNodes,
      dirtyWays,
    };
  }

  private emitChangesChange() {
    this.onChangesChange?.(this.getChanges());
  }

  private resolveSelection(data: NormalizedViewportData, selection: SelectedEntity): SelectedEntity {
    if (!selection) {
      return null;
    }

    if (selection.type === "node") {
      return data.nodesById.has(selection.id) ? selection : null;
    }

    return data.renderedWays.has(selection.id) ? selection : null;
  }

  private buildDisplayData(serverData: NormalizedViewportData): NormalizedViewportData {
    const baseNodesById = new Map(serverData.nodesById);

    for (const [nodeId, pinnedNode] of this.pinnedNodesById) {
      if (!baseNodesById.has(nodeId)) {
        baseNodesById.set(nodeId, pinnedNode);
      }
    }

    for (const [nodeId, createdNode] of this.createdNodesById) {
      baseNodesById.set(nodeId, createdNode);
    }

    const nodesById = new Map<number, NodeSnapshot>();

    for (const [nodeId, node] of baseNodesById) {
      let nextNode = node;
      const editedCoordinate = this.editedNodeCoordinates.get(nodeId);

      if (editedCoordinate) {
        nextNode = applyNodeCoordinate(nextNode, editedCoordinate);
      }

      if (this.activeNodeDrag?.id === nodeId) {
        nextNode = applyNodeCoordinate(nextNode, this.activeNodeDrag.coordinate);
      }

      nodesById.set(nodeId, nextNode);
    }

    const wayTemplates = new Map(serverData.renderedWays);

    for (const [wayId, pinnedWay] of this.pinnedWaysById) {
      if (!wayTemplates.has(wayId)) {
        wayTemplates.set(wayId, cloneRenderedWay(pinnedWay));
      }
    }

    for (const [wayId, createdWay] of this.createdWaysById) {
      wayTemplates.set(wayId, {
        kind:
          createdWay.way.geometryKind === "area" && createdWay.nodeIds.length >= 3
            ? "polygon"
            : "polyline",
        nodeIds: [...createdWay.nodeIds],
        way: createdWay.way,
        coordinates: [],
      });
    }

    if (this.creatingWay) {
      wayTemplates.set(this.creatingWay.id, {
        kind:
          this.creatingWay.way.geometryKind === "area" && this.creatingWay.nodeIds.length >= 3
            ? "polygon"
            : "polyline",
        nodeIds: [...this.creatingWay.nodeIds],
        way: this.creatingWay.way,
        coordinates: [],
      });
    }

    const renderedWays = new Map<number, RenderedWay>();
    const wayIdsByNodeId = new Map<number, number[]>();
    const nodeIdsUsedByWays = new Set<number>();

    for (const [wayId, wayTemplate] of wayTemplates) {
      const coordinates = wayTemplate.nodeIds.flatMap((nodeId) => {
        const node = nodesById.get(nodeId);
        return node ? ([[node.geom.z, node.geom.x]] as RenderedWay["coordinates"]) : [];
      });

      if (coordinates.length < 2) {
        continue;
      }

      renderedWays.set(wayId, {
        ...wayTemplate,
        coordinates,
      });

      for (const nodeId of wayTemplate.nodeIds) {
        nodeIdsUsedByWays.add(nodeId);
        const currentWayIds = wayIdsByNodeId.get(nodeId) ?? [];
        currentWayIds.push(wayId);
        wayIdsByNodeId.set(nodeId, currentWayIds);
      }
    }

    return {
      nodesById,
      renderedWays,
      standaloneNodeIds: new Set(
        [...nodesById.keys()].filter((nodeId) => !nodeIdsUsedByWays.has(nodeId)),
      ),
      wayIdsByNodeId,
    };
  }

  private getVisibleNodeIds(data: NormalizedViewportData) {
    return new Set<number>(data.nodesById.keys());
  }

  private getBaseNode(nodeId: number) {
    return (
      this.serverData?.nodesById.get(nodeId) ??
      this.createdNodesById.get(nodeId) ??
      this.pinnedNodesById.get(nodeId) ??
      null
    );
  }

  private getEffectiveNode(data: NormalizedViewportData, nodeId: number) {
    const node = data.nodesById.get(nodeId);

    if (!node) {
      return null;
    }

    if (this.activeNodeDrag?.id === nodeId) {
      return applyNodeCoordinate(node, this.activeNodeDrag.coordinate);
    }

    const editedCoordinate = this.editedNodeCoordinates.get(nodeId);

    if (!editedCoordinate) {
      return node;
    }

    return applyNodeCoordinate(node, editedCoordinate);
  }

  private getEffectiveWay(data: NormalizedViewportData, wayId: number) {
    const renderedWay = data.renderedWays.get(wayId);

    if (!renderedWay) {
      return null;
    }

    const coordinates = renderedWay.nodeIds.flatMap((nodeId) => {
      const node = this.getEffectiveNode(data, nodeId);
      return node ? ([[node.geom.z, node.geom.x]] as RenderedWay["coordinates"]) : [];
    });

    if (coordinates.length < 2) {
      return null;
    }

    return {
      ...renderedWay,
      coordinates,
    } satisfies RenderedWay;
  }

  private pinNode(nodeId: number) {
    if (this.pinnedNodesById.has(nodeId)) {
      return;
    }

    const node = this.serverData?.nodesById.get(nodeId) ?? this.normalizedData?.nodesById.get(nodeId);

    if (node) {
      this.pinnedNodesById.set(nodeId, node);
    }
  }

  private pinWay(wayId: number) {
    if (this.pinnedWaysById.has(wayId)) {
      return;
    }

    const way = this.serverData?.renderedWays.get(wayId) ?? this.normalizedData?.renderedWays.get(wayId);

    if (!way) {
      return;
    }

    this.pinnedWaysById.set(wayId, cloneRenderedWay(way));

    for (const nodeId of way.nodeIds) {
      this.pinNode(nodeId);
    }
  }

  private patchSelectionChange(previousSelection: SelectedEntity, nextSelection: SelectedEntity) {
    const data = this.normalizedData;

    if (!data) {
      return;
    }

    if (previousSelection?.type === "way" && previousSelection.id !== nextSelection?.id) {
      const previousWay = this.getEffectiveWay(data, previousSelection.id);

      if (previousWay) {
        this.store.upsertWay(previousWay, false);
      }
    }

    if (nextSelection?.type === "way") {
      const nextWay = this.getEffectiveWay(data, nextSelection.id);

      if (nextWay) {
        this.store.upsertWay(nextWay, true);
      }
    }

    const previousVisibleNodeIds = this.getVisibleNodeIds(data);
    const nextVisibleNodeIds = this.getVisibleNodeIds(data);

    for (const nodeId of previousVisibleNodeIds) {
      if (!nextVisibleNodeIds.has(nodeId)) {
        this.store.removeNode(nodeId);
      }
    }

    for (const nodeId of nextVisibleNodeIds) {
      const node = this.getEffectiveNode(data, nodeId);

      if (!node) {
        continue;
      }

      const selected = nextSelection?.type === "node" && nextSelection.id === nodeId;
      const wasSelected = previousSelection?.type === "node" && previousSelection.id === nodeId;

      if (!previousVisibleNodeIds.has(nodeId) || selected !== wasSelected) {
        this.store.upsertNode(node, selected);
      }
    }
  }

  private patchWaysFromViewport(
    previousData: NormalizedViewportData | null,
    nextData: NormalizedViewportData,
    previousSelection: SelectedEntity,
    nextSelection: SelectedEntity,
  ) {
    const previousWays = previousData?.renderedWays ?? new Map<number, RenderedWay>();

    for (const wayId of previousWays.keys()) {
      if (!nextData.renderedWays.has(wayId)) {
        this.store.removeWay(wayId);
      }
    }

    for (const [wayId] of nextData.renderedWays) {
      const previousWay = previousData ? this.getEffectiveWay(previousData, wayId) : null;
      const nextWay = this.getEffectiveWay(nextData, wayId);
      const selected = nextSelection?.type === "way" && nextSelection.id === wayId;
      const wasSelected = previousSelection?.type === "way" && previousSelection.id === wayId;

      if (!nextWay) {
        this.store.removeWay(wayId);
        continue;
      }

      if (!previousWay) {
        this.store.upsertWay(nextWay, selected);
        continue;
      }

      if (didWayGeometryChange(previousWay, nextWay) || selected !== wasSelected) {
        this.store.upsertWay(nextWay, selected);
      }
    }
  }

  private patchNodesFromViewport(
    previousData: NormalizedViewportData | null,
    nextData: NormalizedViewportData,
    previousSelection: SelectedEntity,
    nextSelection: SelectedEntity,
  ) {
    const previousVisibleNodeIds = previousData ? this.getVisibleNodeIds(previousData) : new Set<number>();
    const nextVisibleNodeIds = this.getVisibleNodeIds(nextData);

    for (const nodeId of previousVisibleNodeIds) {
      if (!nextVisibleNodeIds.has(nodeId)) {
        this.store.removeNode(nodeId);
      }
    }

    for (const nodeId of nextVisibleNodeIds) {
      const nextNode = this.getEffectiveNode(nextData, nodeId);

      if (!nextNode) {
        continue;
      }

      const previousNode = previousData ? this.getEffectiveNode(previousData, nodeId) : null;
      const selected = nextSelection?.type === "node" && nextSelection.id === nodeId;
      const wasSelected = previousSelection?.type === "node" && previousSelection.id === nodeId;
      const geometryChanged = !previousNode || !sameNodeGeometry(previousNode, nextNode);

      if (!previousVisibleNodeIds.has(nodeId) || geometryChanged || selected !== wasSelected) {
        this.store.upsertNode(nextNode, selected);
      }
    }
  }

  private patchDraggedNode(nodeId: number) {
    const data = this.normalizedData;

    if (!data) {
      return;
    }

    const visibleNodeIds = this.getVisibleNodeIds(data);
    const selected = this.visibleSelection?.type === "node" && this.visibleSelection.id === nodeId;
    const draggingThisNode = this.activeNodeDrag?.id === nodeId;

    if (visibleNodeIds.has(nodeId) && !draggingThisNode) {
      const node = this.getEffectiveNode(data, nodeId);

      if (node) {
        this.store.upsertNode(node, selected);
      }
    }

    const affectedWayIds = data.wayIdsByNodeId.get(nodeId) ?? [];

    for (const wayId of affectedWayIds) {
      const way = this.getEffectiveWay(data, wayId);

      if (!way) {
        this.store.removeWay(wayId);
        continue;
      }

      const waySelected = this.visibleSelection?.type === "way" && this.visibleSelection.id === wayId;
      this.store.upsertWay(way, waySelected);
    }
  }

  private startNodeDrag(nodeId: number) {
    const data = this.normalizedData;

    if (!data) {
      return;
    }

    const node = this.getEffectiveNode(data, nodeId);

    if (!node) {
      return;
    }

    this.pinNode(nodeId);

    for (const wayId of data.wayIdsByNodeId.get(nodeId) ?? []) {
      this.pinWay(wayId);
    }

    this.activeNodeDrag = {
      id: nodeId,
      coordinate: {
        x: node.geom.x,
        y: node.geom.y,
        z: node.geom.z,
      },
    };
    this.emitChangesChange();
  }

  private moveNodeDrag(nodeId: number, coordinate: { x: number; z: number }) {
    const data = this.normalizedData;

    if (!data) {
      return;
    }

    const node = this.getEffectiveNode(data, nodeId);

    if (!node) {
      return;
    }

    this.activeNodeDrag = {
      id: nodeId,
      coordinate: {
        x: coordinate.x,
        y: node.geom.y,
        z: coordinate.z,
      },
    };
    this.emitChangesChange();
    this.patchDraggedNode(nodeId);
  }

  private endNodeDrag(nodeId: number, coordinate: { x: number; z: number }) {
    const data = this.normalizedData;

    if (!data) {
      this.activeNodeDrag = null;
      return;
    }

    const baseNode = this.getBaseNode(nodeId);

    if (!baseNode) {
      this.activeNodeDrag = null;
      return;
    }

    const nextCoordinate = {
      x: coordinate.x,
      y: baseNode.geom.y,
      z: coordinate.z,
    };

    this.activeNodeDrag = {
      id: nodeId,
      coordinate: nextCoordinate,
    };

    if (sameNodeGeometry(baseNode, applyNodeCoordinate(baseNode, nextCoordinate))) {
      this.editedNodeCoordinates.delete(nodeId);
    } else {
      this.editedNodeCoordinates.set(nodeId, nextCoordinate);
    }

    this.activeNodeDrag = null;
    this.normalizedData = this.serverData ? this.buildDisplayData(this.serverData) : this.normalizedData;
    this.emitChangesChange();
    this.patchDraggedNode(nodeId);
  }
}
