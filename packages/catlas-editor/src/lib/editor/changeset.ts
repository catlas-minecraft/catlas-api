import { entityEqual, Graph } from "../graph";
import type { components } from "./catlas-api.gen";
import { entityKey, type EditorEntity, type NodeEntity, type WayEntity } from "./types";

type WithLocalId<T> = Omit<T, "changesetId"> & { readonly id: number };

type ChangesetUploadDiffEntry = {
  readonly oldId: number;
  readonly newId: number;
  readonly newVersion: number;
};

export type ChangesetUploadPayload = {
  readonly create: {
    readonly nodes: readonly WithLocalId<components["schemas"]["NodeInput"]>[];
    readonly ways: readonly WithLocalId<components["schemas"]["WayInput"]>[];
    readonly relations: readonly [];
  };
  readonly modify: {
    readonly nodes: readonly WithLocalId<components["schemas"]["NodePatch"]>[];
    readonly ways: readonly WithLocalId<components["schemas"]["WayPatch"]>[];
    readonly relations: readonly [];
  };
  readonly delete: {
    readonly nodes: readonly WithLocalId<components["schemas"]["DeleteInput"]>[];
    readonly ways: readonly WithLocalId<components["schemas"]["DeleteInput"]>[];
    readonly relations: readonly [];
  };
};

export type ChangesetUploadDiffResult = {
  readonly nodes: readonly ChangesetUploadDiffEntry[];
  readonly ways: readonly ChangesetUploadDiffEntry[];
  readonly relations: readonly ChangesetUploadDiffEntry[];
};

export type GraphDifference = {
  readonly created: readonly EditorEntity[];
  readonly modified: readonly EditorEntity[];
  readonly deleted: readonly EditorEntity[];
};

export type ChangesetReviewValue = string | number | null | readonly number[];

export type ChangesetReviewField = {
  readonly key: string;
  readonly label: string;
  readonly before: ChangesetReviewValue;
  readonly after: ChangesetReviewValue;
};

export type ChangesetReviewEntry = {
  readonly key: string;
  readonly kind: "create" | "modify" | "delete";
  readonly ref: { readonly type: "node" | "way"; readonly id: number };
  readonly label: string | null;
  readonly geometry: "point" | "line" | "area";
  readonly expectedVersion: number | null;
  readonly fields: readonly ChangesetReviewField[];
};

export type ChangesetReview = {
  readonly entries: readonly ChangesetReviewEntry[];
  readonly counts: {
    readonly created: number;
    readonly modified: number;
    readonly deleted: number;
    readonly total: number;
  };
  readonly payload: ChangesetUploadPayload;
};

export const difference = (base: Graph, current: Graph): GraphDifference => {
  const created = current.entities().filter((entity) => !base.has(entity));
  const modified = current.entities().filter((entity) => {
    const baseEntity = base.entity(entity);
    return baseEntity !== undefined && !entityEqual(baseEntity, entity);
  });
  const deleted = base.entities().filter((entity) => !current.has(entity));
  return { created, modified, deleted };
};

const nodeCreate = (node: NodeEntity) => ({
  id: node.id,
  geom: node.geom,
  tags: { ...node.tags },
});

const nodeModify = (node: NodeEntity) => ({
  ...nodeCreate(node),
  expectedVersion: node.version,
});

const wayCreate = (way: WayEntity) => ({
  id: way.id,
  geometryKind: way.geometryKind,
  nodeRefs: [...way.nodeIds],
  tags: { ...way.tags },
});

const wayModify = (way: WayEntity) => ({
  ...wayCreate(way),
  expectedVersion: way.version,
});

export const toChangesetUpload = (base: Graph, current: Graph): ChangesetUploadPayload => {
  const diff = difference(base, current);
  const createdNodes = diff.created.filter(
    (entity): entity is NodeEntity => entity.type === "node",
  );
  const createdWays = diff.created.filter((entity): entity is WayEntity => entity.type === "way");
  const modifiedNodes = diff.modified.filter(
    (entity): entity is NodeEntity => entity.type === "node",
  );
  const modifiedWays = diff.modified.filter((entity): entity is WayEntity => entity.type === "way");
  const deletedNodes = diff.deleted.filter(
    (entity): entity is NodeEntity => entity.type === "node",
  );
  const deletedWays = diff.deleted.filter((entity): entity is WayEntity => entity.type === "way");

  return {
    create: {
      nodes: createdNodes.map(nodeCreate),
      ways: createdWays.map(wayCreate),
      relations: [],
    },
    modify: {
      nodes: modifiedNodes.map(nodeModify),
      ways: modifiedWays.map(wayModify),
      relations: [],
    },
    delete: {
      nodes: deletedNodes.map((node) => ({ id: node.id, expectedVersion: node.version })),
      ways: deletedWays.map((way) => ({ id: way.id, expectedVersion: way.version })),
      relations: [],
    },
  };
};

const valuesEqual = (left: ChangesetReviewValue, right: ChangesetReviewValue) => {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return left === right;
};

const fieldChanges = (
  kind: ChangesetReviewEntry["kind"],
  before: EditorEntity | null,
  after: EditorEntity | null,
) => {
  const fields: ChangesetReviewField[] = [];
  const include = (
    key: string,
    label: string,
    beforeValue: ChangesetReviewValue,
    afterValue: ChangesetReviewValue,
  ) => {
    if (kind === "modify" && valuesEqual(beforeValue, afterValue)) return;
    fields.push({ key, label, before: beforeValue, after: afterValue });
  };

  if (before?.type === "node" || after?.type === "node") {
    const beforeNode = before?.type === "node" ? before : null;
    const afterNode = after?.type === "node" ? after : null;
    include("geom.x", "X", beforeNode?.geom.x ?? null, afterNode?.geom.x ?? null);
    include("geom.y", "Y", beforeNode?.geom.y ?? null, afterNode?.geom.y ?? null);
    include("geom.z", "Z", beforeNode?.geom.z ?? null, afterNode?.geom.z ?? null);
  }

  if (before?.type === "way" || after?.type === "way") {
    const beforeWay = before?.type === "way" ? before : null;
    const afterWay = after?.type === "way" ? after : null;
    include(
      "geometryKind",
      "Geometry",
      beforeWay?.geometryKind ?? null,
      afterWay?.geometryKind ?? null,
    );
    include("nodeRefs", "Node refs", beforeWay?.nodeIds ?? null, afterWay?.nodeIds ?? null);
  }

  const tagKeys = new Set([...Object.keys(before?.tags ?? {}), ...Object.keys(after?.tags ?? {})]);
  for (const key of [...tagKeys].toSorted()) {
    include(`tags.${key}`, `Tag: ${key}`, before?.tags[key] ?? null, after?.tags[key] ?? null);
  }

  return fields;
};

const reviewEntry = (
  kind: ChangesetReviewEntry["kind"],
  before: EditorEntity | null,
  after: EditorEntity | null,
): ChangesetReviewEntry => {
  const entity = after ?? before;
  if (!entity) throw new Error("A changeset review entry requires an entity");

  return {
    key: entityKey(entity),
    kind,
    ref: { type: entity.type, id: entity.id },
    label: entity.tags.name ?? null,
    geometry: entity.type === "node" ? "point" : entity.geometryKind,
    expectedVersion: kind === "create" ? null : entity.version,
    fields: fieldChanges(kind, before, after),
  };
};

export const buildChangesetReview = (base: Graph, current: Graph): ChangesetReview => {
  const diff = difference(base, current);
  const created = diff.created.map((entity) => reviewEntry("create", null, entity));
  const modified = diff.modified.map((entity) =>
    reviewEntry("modify", base.entity(entity) ?? null, entity),
  );
  const deleted = diff.deleted.map((entity) => reviewEntry("delete", entity, null));

  return {
    entries: [...created, ...modified, ...deleted],
    counts: {
      created: created.length,
      modified: modified.length,
      deleted: deleted.length,
      total: created.length + modified.length + deleted.length,
    },
    payload: toChangesetUpload(base, current),
  };
};

export const diffResultToRemaps = (result: ChangesetUploadDiffResult) =>
  new Map<string, { readonly id: number; readonly version: number }>([
    ...result.nodes.map(
      (entry) => [`n${entry.oldId}`, { id: entry.newId, version: entry.newVersion }] as const,
    ),
    ...result.ways.map(
      (entry) => [`w${entry.oldId}`, { id: entry.newId, version: entry.newVersion }] as const,
    ),
  ]);

export const countChanges = (base: Graph, current: Graph) => {
  const diff = difference(base, current);
  return diff.created.length + diff.modified.length + diff.deleted.length;
};

export const changedEntityKeys = (base: Graph, current: Graph) => {
  const diff = difference(base, current);
  return new Set([...diff.created, ...diff.modified, ...diff.deleted].map(entityKey));
};
