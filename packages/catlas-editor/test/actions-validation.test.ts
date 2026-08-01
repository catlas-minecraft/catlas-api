import { describe, expect, test } from "vite-plus/test";
import { Graph } from "../src/lib/graph";
import {
  deleteEntity,
  insertNodeIntoWay,
  joinWays,
  splitWayAtNode,
} from "../src/lib/editor/actions";
import { getOperation } from "../src/lib/editor/operations";
import { validateGraph } from "../src/lib/editor/validation";
import { area, line, node } from "./helpers";

describe("editor actions", () => {
  test("deleting an area vertex preserves a valid closed ring", () => {
    const graph = new Graph([node(1), node(2), node(3), node(4), area(10, [1, 2, 3, 4, 1])]);
    const next = deleteEntity({ type: "node", id: 2 })(graph);

    expect(next.node(2)).toBeUndefined();
    expect(next.way(10)?.nodeIds).toEqual([1, 3, 4, 1]);
    expect(validateGraph(next).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  test("deleting a vertex removes ways that become too short", () => {
    const graph = new Graph([node(1), node(2), line(10, [1, 2])]);
    const next = deleteEntity({ type: "node", id: 2 })(graph);
    expect(next.way(10)).toBeUndefined();
  });

  test("inserting a midpoint creates the node and updates the way", () => {
    const graph = new Graph([node(1), node(2), line(10, [1, 2])]);
    const next = insertNodeIntoWay(10, 1, node(-1, 1.5, 1.5))(graph);
    expect(next.node(-1)).toBeDefined();
    expect(next.way(10)?.nodeIds).toEqual([1, -1, 2]);
  });

  test("deleting a local way removes its untagged local vertices", () => {
    const graph = new Graph([{ ...node(-1) }, { ...node(-2) }, line(-1, [-1, -2])]);
    const next = deleteEntity({ type: "way", id: -1 })(graph);

    expect(next.way(-1)).toBeUndefined();
    expect(next.node(-1)).toBeUndefined();
    expect(next.node(-2)).toBeUndefined();
  });

  test("deleting a way preserves tagged and shared nodes", () => {
    const graph = new Graph([
      { ...node(1), tags: { name: "Landmark" } },
      node(2),
      node(3),
      line(10, [1, 2]),
      line(11, [2, 3]),
    ]);
    const next = deleteEntity({ type: "way", id: 10 })(graph);

    expect(next.way(10)).toBeUndefined();
    expect(next.node(1)?.tags).toEqual({ name: "Landmark" });
    expect(next.node(2)).toBeDefined();
    expect(next.way(11)?.nodeIds).toEqual([2, 3]);
  });

  const joinCases = [
    { name: "end to start", keep: [1, 2], merge: [2, 3], expected: [1, 2, 3] },
    { name: "start to end", keep: [2, 3], merge: [1, 2], expected: [1, 2, 3] },
    { name: "start to start", keep: [2, 3], merge: [2, 1], expected: [1, 2, 3] },
    { name: "end to end", keep: [1, 2], merge: [3, 2], expected: [1, 2, 3] },
  ] as const;

  for (const joinCase of joinCases) {
    test(`joining lines handles ${joinCase.name}`, () => {
      const graph = new Graph([
        node(1),
        node(2),
        node(3),
        { ...line(10, joinCase.keep), tags: { name: "Keep" } },
        line(11, joinCase.merge),
      ]);
      const next = joinWays(10, 11)(graph);

      expect(next.way(10)?.nodeIds).toEqual(joinCase.expected);
      expect(next.way(10)?.tags.name).toBe("Keep");
      expect(next.way(10)?.tags).toEqual({ name: "Keep" });
      expect(next.way(11)).toBeUndefined();
    });
  }

  test("joining leaves invalid line combinations unchanged", () => {
    const sameWayGraph = new Graph([node(1), node(2), line(10, [1, 2])]);
    const disconnectedGraph = new Graph([
      node(1),
      node(2),
      node(3),
      node(4),
      line(10, [1, 2]),
      line(11, [3, 4]),
    ]);
    const duplicateEndpointGraph = new Graph([
      node(1),
      node(2),
      line(10, [1, 2]),
      line(11, [2, 1]),
    ]);
    const areaGraph = new Graph([
      node(1),
      node(2),
      node(3),
      line(10, [1, 2]),
      area(11, [2, 3, 1, 2]),
    ]);

    expect(joinWays(10, 10)(sameWayGraph)).toBe(sameWayGraph);
    expect(joinWays(10, 11)(disconnectedGraph)).toBe(disconnectedGraph);
    expect(joinWays(10, 11)(duplicateEndpointGraph)).toBe(duplicateEndpointGraph);
    expect(joinWays(10, 11)(areaGraph)).toBe(areaGraph);
  });

  test("splitting a line keeps the first segment and creates a matching local way", () => {
    const graph = new Graph([
      node(1),
      node(2),
      node(3),
      node(4),
      { ...line(10, [1, 2, 3, 4]), tags: { name: "Main" } },
    ]);
    const next = splitWayAtNode(10, 3, -1)(graph);

    expect(next.way(10)?.nodeIds).toEqual([1, 2, 3]);
    expect(next.way(-1)).toMatchObject({
      version: 0,
      tags: { name: "Main" },
      geometryKind: "line",
      nodeIds: [3, 4],
    });
  });

  test("splitting leaves invalid targets unchanged", () => {
    const lineGraph = new Graph([node(1), node(2), node(3), line(-1, [1, 3]), line(10, [1, 2, 3])]);
    const duplicateNodeGraph = new Graph([node(1), node(2), node(3), line(10, [1, 2, 3, 2, 1])]);
    const areaGraph = new Graph([node(1), node(2), node(3), area(10, [1, 2, 3, 1])]);

    expect(splitWayAtNode(10, 1, -2)(lineGraph)).toBe(lineGraph);
    expect(splitWayAtNode(10, 4, -2)(lineGraph)).toBe(lineGraph);
    expect(splitWayAtNode(10, 2, -1)(lineGraph)).toBe(lineGraph);
    expect(splitWayAtNode(10, 2, -1)(duplicateNodeGraph)).toBe(duplicateNodeGraph);
    expect(splitWayAtNode(10, 2, -1)(areaGraph)).toBe(areaGraph);
  });

  test("join operation is available only for selected line plus target line endpoint joins", () => {
    const graph = new Graph([
      node(1),
      node(2),
      node(3),
      node(4),
      line(10, [1, 2]),
      line(11, [2, 3]),
      line(12, [3, 4]),
      line(13, [2, 1]),
      area(20, [1, 2, 3, 1]),
    ]);

    expect(
      getOperation("join", graph, { type: "way", id: 10 }, { type: "way", id: 11 }).available,
    ).toBe(true);
    expect(getOperation("join", graph, null, { type: "way", id: 11 }).available).toBe(false);
    expect(
      getOperation("join", graph, { type: "way", id: 10 }, { type: "way", id: 10 }).disabledReason,
    ).toBe("Choose another line to join.");
    expect(
      getOperation("join", graph, { type: "way", id: 20 }, { type: "way", id: 11 }).disabledReason,
    ).toBe("Only lines can be joined.");
    expect(
      getOperation("join", graph, { type: "way", id: 10 }, { type: "way", id: 20 }).disabledReason,
    ).toBe("Only lines can be joined.");
    expect(
      getOperation("join", graph, { type: "way", id: 10 }, { type: "way", id: 12 }).disabledReason,
    ).toBe("Lines must share exactly one endpoint.");
    expect(
      getOperation("join", graph, { type: "way", id: 10 }, { type: "way", id: 13 }).disabledReason,
    ).toBe("Lines must share exactly one endpoint.");
  });

  test("split operation is available only for an internal vertex of the selected line", () => {
    const graph = new Graph([
      node(1),
      node(2),
      node(3),
      node(4),
      line(10, [1, 2, 3]),
      area(20, [1, 2, 3, 1]),
    ]);

    const operation = getOperation(
      "split",
      graph,
      { type: "way", id: 10 },
      { type: "node", id: 2 },
      -1,
    );
    expect(operation.available).toBe(true);
    expect(operation.action?.(graph).way(10)?.nodeIds).toEqual([1, 2]);
    expect(operation.action?.(graph).way(-1)?.nodeIds).toEqual([2, 3]);
    expect(
      getOperation("split", graph, { type: "way", id: 10 }, { type: "node", id: 1 }).disabledReason,
    ).toBe("Endpoints cannot split a line.");
    expect(
      getOperation("split", graph, { type: "way", id: 10 }, { type: "node", id: 4 }).disabledReason,
    ).toBe("The vertex must belong to the selected line.");
    expect(
      getOperation("split", graph, { type: "way", id: 20 }, { type: "node", id: 2 }).disabledReason,
    ).toBe("Only lines can be split.");
  });

  test("delete operation can target the right-clicked entity", () => {
    const graph = new Graph([node(1), node(2), node(3), line(10, [1, 2]), line(11, [2, 3])]);
    const operation = getOperation(
      "delete",
      graph,
      { type: "way", id: 10 },
      { type: "way", id: 11 },
    );

    expect(operation.available).toBe(true);
    expect(operation.action?.(graph).way(10)).toBeDefined();
    expect(operation.action?.(graph).way(11)).toBeUndefined();
  });
});

describe("validation", () => {
  test("blocks open areas, missing nodes, and reserved tags", () => {
    const graph = new Graph([{ ...node(1), tags: { version: "bad" } }, area(10, [1, 2, 3])]);
    const messages = validateGraph(graph).map((issue) => issue.message);

    expect(messages).toContain("Tag 'version' is reserved.");
    expect(messages).toContain("An area must be closed.");
    expect(messages).toContain("Referenced node 2 is missing.");
  });
});
