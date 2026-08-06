import { describe, expect, test } from "vite-plus/test";
import { Graph } from "../src/lib/graph";
import { buildChangesetReview, difference, toChangesetUpload } from "../src/lib/editor/changeset";
import { area, line, node } from "./helpers";

describe("changeset serialization", () => {
  test("classifies creates, modifications, and deletes", () => {
    const base = new Graph([node(1, 1, 1, 3), node(2), line(5, [1, 2], 4), node(9)]);
    const current = new Graph([
      { ...node(1, 1, 1, 3), geom: { x: 4, y: 2, z: 8 } },
      node(2),
      line(5, [1, 2], 4),
      node(-1, 10, 10),
      area(-1, [-1, 2, 1, -1]),
    ]);
    const diff = difference(base, current);
    const payload = toChangesetUpload(base, current);

    expect(diff.created.map((entity) => `${entity.type}:${entity.id}`)).toEqual([
      "node:-1",
      "way:-1",
    ]);
    expect(diff.modified.map((entity) => `${entity.type}:${entity.id}`)).toEqual(["node:1"]);
    expect(diff.deleted.map((entity) => `${entity.type}:${entity.id}`)).toEqual(["node:9"]);
    expect(payload.modify.nodes[0]?.expectedVersion).toBe(3);
    expect(payload.create.ways[0]?.nodeRefs).toEqual([-1, 2, 1, -1]);
    expect(payload.delete.nodes).toEqual([{ id: 9, expectedVersion: 1 }]);
    expect(payload.create.nodes[0]).not.toHaveProperty("changesetId");
    expect(payload.create.ways[0]).not.toHaveProperty("changesetId");
  });

  test("builds field-level review entries from the upload payload source graphs", () => {
    const baseNode = {
      ...node(1, 1, 2, 3),
      tags: { name: "Old", removed: "yes" },
    };
    const baseWay = { ...line(5, [1, 2], 4), tags: { surface: "stone" } };
    const base = new Graph([baseNode, node(2), node(3), baseWay, node(9)]);
    const currentNode = {
      ...baseNode,
      geom: { x: 4, y: 0, z: 2 },
      tags: { name: "New", added: "yes" },
    };
    const currentWay = { ...baseWay, nodeIds: [1, 3], tags: { surface: "wood" } };
    const current = new Graph([currentNode, node(2), node(3), currentWay, node(-1, 10, 12)]);

    const review = buildChangesetReview(base, current);
    const nodeEntry = review.entries.find((entry) => entry.key === "n1");
    const wayEntry = review.entries.find((entry) => entry.key === "w5");

    expect(review.counts).toEqual({ created: 1, modified: 2, deleted: 1, total: 4 });
    expect(nodeEntry?.fields).toEqual([
      { key: "geom.x", label: "X", before: 1, after: 4 },
      { key: "tags.added", label: "Tag: added", before: null, after: "yes" },
      { key: "tags.name", label: "Tag: name", before: "Old", after: "New" },
      { key: "tags.removed", label: "Tag: removed", before: "yes", after: null },
    ]);
    expect(wayEntry?.fields).toEqual([
      { key: "nodeRefs", label: "Node refs", before: [1, 2], after: [1, 3] },
      { key: "tags.surface", label: "Tag: surface", before: "stone", after: "wood" },
    ]);
    expect(review.payload).toEqual(toChangesetUpload(base, current));
  });
});
