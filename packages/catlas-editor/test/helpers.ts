import type { NodeEntity, WayEntity } from "../src/lib/editor/types";

export const node = (id: number, x = id, z = id, version = id < 0 ? 0 : 1): NodeEntity => ({
  type: "node",
  id,
  version,
  tags: {},
  geom: { x, y: 0, z },
});

export const line = (
  id: number,
  nodeIds: readonly number[],
  version = id < 0 ? 0 : 1,
): WayEntity => ({
  type: "way",
  id,
  version,
  tags: {},
  geometryKind: "line",
  nodeIds,
});

export const area = (
  id: number,
  nodeIds: readonly number[],
  version = id < 0 ? 0 : 1,
): WayEntity => ({
  type: "way",
  id,
  version,
  tags: {},
  geometryKind: "area",
  nodeIds,
});
