import { describe, expect, test } from "vite-plus/test";
import { Graph } from "../src/lib/graph";
import type { EditorApiService } from "../src/lib/editor/api-client";
import { toChangesetUpload } from "../src/lib/editor/changeset";
import { getOperation } from "../src/lib/editor/operations";
import { loadViewportEntities, saveGraph } from "../src/lib/editor/sync";
import { line, node } from "./helpers";

const emptyViewport = {
  nodes: [],
  ways: [],
  wayNodes: [],
  relations: [],
  relationMembers: [],
};

const notUsed = async (): Promise<never> => {
  throw new Error("not used");
};

const unusedApi = {
  getSession: notUsed,
  createSession: notUsed,
  deleteSession: notUsed,
  listChangesets: notUsed,
};

describe("operations", () => {
  test("reports availability and a disabled reason separately", () => {
    const graph = new Graph([node(1)]);
    const disabled = getOperation("delete", graph, null);
    const enabled = getOperation("delete", graph, { type: "node", id: 1 });

    expect(disabled.available).toBe(false);
    expect(disabled.disabledReason).toBe("Select a feature to delete it.");
    expect(enabled.available).toBe(true);
    expect(enabled.disabledReason).toBeNull();
    expect(enabled.action?.(graph).node(1)).toBeUndefined();
  });
});

describe("API synchronization", () => {
  test("loads viewport entities through the service boundary", async () => {
    const api: EditorApiService = {
      ...unusedApi,
      loadViewport: async () => ({
        ...emptyViewport,
        nodes: [
          {
            id: 7,
            geom: { x: 1, y: 2, z: 3 },
            tags: {},
            version: 4,
            deletedAt: null,
            changesetId: 1,
          },
        ],
      }),
      save: notUsed,
    };

    const viewport = await loadViewportEntities(api, [0, 0, 10, 10]);
    expect(viewport.entities).toHaveLength(1);
    expect(viewport.entities[0]?.id).toBe(7);
  });

  test("uploads a graph and applies returned ids and versions", async () => {
    let uploadedNodeId: number | undefined;
    const api: EditorApiService = {
      ...unusedApi,
      loadViewport: async () => emptyViewport,
      save: async (payload) => {
        uploadedNodeId = payload.create.nodes[0]?.id;
        return {
          nodes: [{ oldId: -1, newId: 101, newVersion: 1 }],
          ways: [{ oldId: -1, newId: 201, newVersion: 1 }],
          relations: [],
        };
      },
    };
    const base = new Graph();
    const current = new Graph([node(-1), line(-1, [-1, -1])]);

    const saved = await saveGraph(api, current, toChangesetUpload(base, current), "test");
    expect(uploadedNodeId).toBe(-1);
    expect(saved.graph.node(101)?.version).toBe(1);
    expect(saved.graph.way(201)?.nodeIds).toEqual([101, 101]);
  });

  test("preserves API failures for the editor", async () => {
    const failure = new Error("Version conflict");
    const api: EditorApiService = {
      ...unusedApi,
      loadViewport: async () => emptyViewport,
      save: async () => {
        throw failure;
      },
    };

    const base = new Graph();
    const current = new Graph([node(-1)]);
    await expect(saveGraph(api, current, toChangesetUpload(base, current), null)).rejects.toBe(
      failure,
    );
  });
});
