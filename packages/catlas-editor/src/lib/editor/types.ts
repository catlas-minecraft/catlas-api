import type { components } from "@catlas/api-client";

export type EntityType = "node" | "way";
export type GeometryType = "point" | "line" | "area";
export type EditorMode = "browse" | "add-point" | "draw-line" | "draw-area";
export type SnapPolicy = "integer" | "half" | "free";

export type EntityRef = {
  readonly type: EntityType;
  readonly id: number;
};

export type Point3D = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type EditorContextMenu = {
  readonly target: EntityRef | null;
  readonly targetEntity: EditorEntity | null;
  readonly world: Point3D;
  readonly x: number;
  readonly y: number;
};

export type NodeEntity = {
  readonly type: "node";
  readonly id: number;
  readonly version: number;
  readonly tags: Readonly<Record<string, string>>;
  readonly geom: Point3D;
};

export type WayEntity = {
  readonly type: "way";
  readonly id: number;
  readonly version: number;
  readonly tags: Readonly<Record<string, string>>;
  readonly geometryKind: "line" | "area";
  readonly nodeIds: readonly number[];
};

export type EditorEntity = NodeEntity | WayEntity;

export type DraftVertex = {
  readonly nodeId: number | null;
  readonly point: Point3D;
};

export type DrawingState = {
  readonly geometryKind: "line" | "area";
  readonly vertices: readonly DraftVertex[];
  readonly pointer: Point3D | null;
};

export type ValidationIssue = {
  readonly id: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly entity: EntityRef | null;
};

export type EditorSaveState =
  | { readonly status: "idle" }
  | { readonly status: "saving" }
  | { readonly status: "saved"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

export type EditorAuthState =
  | { readonly status: "anonymous" }
  | { readonly status: "checking" }
  | { readonly status: "authenticating" }
  | {
      readonly status: "authenticated";
      readonly user: { readonly id: number; readonly userId: string; readonly username: string };
    }
  | { readonly status: "error"; readonly message: string };

export type EditorAuthConfig = {
  readonly oidcEnabled: boolean;
  readonly developerAuthEnabled: boolean;
};

export type EditorSnapshot = {
  readonly mode: EditorMode;
  readonly activeFeatureId: string | null;
  readonly cursor: Point3D | null;
  readonly selection: EntityRef | null;
  readonly selectedEntity: EditorEntity | null;
  readonly changePreview: EntityRef | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly dirty: boolean;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly drawing: DrawingState | null;
  readonly contextMenu: EditorContextMenu | null;
  readonly issues: readonly ValidationIssue[];
  readonly save: EditorSaveState;
  readonly auth: EditorAuthState;
  readonly authConfig: EditorAuthConfig;
};

export type ViewportEntities = {
  readonly entities: readonly EditorEntity[];
  readonly loadedEntityKeys: ReadonlySet<string>;
};

export const entityKey = ({ type, id }: EntityRef) => `${type[0]}${id}`;

export const entityRef = (entity: EditorEntity): EntityRef => ({
  type: entity.type,
  id: entity.id,
});

export const sameEntityRef = (left: EntityRef | null, right: EntityRef | null) =>
  left?.type === right?.type && left?.id === right?.id;

const toNodeEntity = (node: components["schemas"]["ViewportNode"]): NodeEntity => ({
  type: "node",
  id: node.id,
  version: node.version,
  tags: { ...node.tags },
  geom: { x: node.geom.x, y: node.geom.y, z: node.geom.z },
});

const toWayEntity = (
  way: components["schemas"]["ViewportWay"],
  wayNodes: readonly components["schemas"]["ViewportWayNode"][],
): WayEntity => ({
  type: "way",
  id: way.id,
  version: way.version,
  tags: { ...way.tags },
  geometryKind: way.geometryKind,
  nodeIds: wayNodes
    .filter((wayNode) => wayNode.wayId === way.id)
    .toSorted((left, right) => left.seq - right.seq)
    .map((wayNode) => wayNode.nodeId),
});

export const viewportToEntities = (
  snapshot: components["schemas"]["Viewport"],
): ViewportEntities => {
  const nodes = snapshot.nodes.map(toNodeEntity);
  const ways = snapshot.ways.map((way) => toWayEntity(way, snapshot.wayNodes));
  const entities: EditorEntity[] = [...nodes, ...ways];

  return {
    entities,
    loadedEntityKeys: new Set(entities.map((entity) => entityKey(entity))),
  };
};

export const cloneTags = (tags: Readonly<Record<string, string>>) => ({ ...tags });

export const geometryTypeForEntity = (entity: EditorEntity): GeometryType =>
  entity.type === "node" ? "point" : entity.geometryKind;
