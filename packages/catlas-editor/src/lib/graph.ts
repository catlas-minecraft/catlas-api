import {
  type EditorEntity,
  type EntityRef,
  entityKey,
  type NodeEntity,
  type WayEntity,
} from "./editor/types";

const tagsEqual = (
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
) => {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
};

export const entityEqual = (left: EditorEntity | undefined, right: EditorEntity | undefined) => {
  if (left === right) return true;
  if (!left || !right || left.type !== right.type || left.id !== right.id) return false;
  if (left.version !== right.version || !tagsEqual(left.tags, right.tags)) {
    return false;
  }

  if (left.type === "node" && right.type === "node") {
    return (
      left.geom.x === right.geom.x && left.geom.y === right.geom.y && left.geom.z === right.geom.z
    );
  }

  if (left.type === "way" && right.type === "way") {
    return (
      left.geometryKind === right.geometryKind &&
      left.nodeIds.length === right.nodeIds.length &&
      left.nodeIds.every((nodeId, index) => nodeId === right.nodeIds[index])
    );
  }

  return false;
};

export class Graph {
  readonly #entities: ReadonlyMap<string, EditorEntity>;

  constructor(entities: Iterable<EditorEntity> = []) {
    this.#entities = new Map([...entities].map((entity) => [entityKey(entity), entity] as const));
  }

  entity(ref: EntityRef): EditorEntity | undefined {
    return this.#entities.get(entityKey(ref));
  }

  node(id: number): NodeEntity | undefined {
    const entity = this.entity({ type: "node", id });
    return entity?.type === "node" ? entity : undefined;
  }

  way(id: number): WayEntity | undefined {
    const entity = this.entity({ type: "way", id });
    return entity?.type === "way" ? entity : undefined;
  }

  has(ref: EntityRef) {
    return this.#entities.has(entityKey(ref));
  }

  entities(): readonly EditorEntity[] {
    return [...this.#entities.values()];
  }

  nodes(): readonly NodeEntity[] {
    return this.entities().filter((entity): entity is NodeEntity => entity.type === "node");
  }

  ways(): readonly WayEntity[] {
    return this.entities().filter((entity): entity is WayEntity => entity.type === "way");
  }

  parentWays(nodeId: number): readonly WayEntity[] {
    return this.ways().filter((way) => way.nodeIds.includes(nodeId));
  }

  replace(entity: EditorEntity): Graph {
    const current = this.#entities.get(entityKey(entity));
    if (entityEqual(current, entity)) return this;

    const entities = new Map(this.#entities);
    entities.set(entityKey(entity), entity);
    return Graph.fromMap(entities);
  }

  replaceAll(nextEntities: Iterable<EditorEntity>): Graph {
    return [...nextEntities].reduce<Graph>((graph, entity) => graph.replace(entity), this);
  }

  remove(ref: EntityRef): Graph {
    const key = entityKey(ref);
    if (!this.#entities.has(key)) return this;

    const entities = new Map(this.#entities);
    entities.delete(key);
    return Graph.fromMap(entities);
  }

  remapIds(remaps: ReadonlyMap<string, { readonly id: number; readonly version: number }>): Graph {
    const nodeIdMap = new Map<number, number>();
    for (const [key, remap] of remaps) {
      if (key.startsWith("n")) nodeIdMap.set(Number(key.slice(1)), remap.id);
    }

    return new Graph(
      this.entities().map((entity): EditorEntity => {
        const remap = remaps.get(entityKey(entity));
        const nextId = remap?.id ?? entity.id;
        const nextVersion = remap?.version ?? entity.version;
        if (entity.type === "node") {
          return { ...entity, id: nextId, version: nextVersion };
        }

        return {
          ...entity,
          id: nextId,
          version: nextVersion,
          nodeIds: entity.nodeIds.map((nodeId) => nodeIdMap.get(nodeId) ?? nodeId),
        };
      }),
    );
  }

  static fromMap(entities: ReadonlyMap<string, EditorEntity>): Graph {
    return new Graph(entities.values());
  }
}
