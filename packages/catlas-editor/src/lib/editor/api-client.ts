import createClient from "openapi-fetch";
import { json, noContent } from "../api-response";
import type { components, paths } from "./catlas-api.gen";
import type { ChangesetUploadDiffResult, ChangesetUploadPayload } from "./changeset";

type SessionInfo = { readonly user: components["schemas"]["User"] | null };
type IdVersion = components["schemas"]["IdVersion"];
type Changeset = components["schemas"]["Changeset"];

export type ChangesetListPage = {
  readonly changesets: readonly Changeset[];
  readonly nextBeforeId: number | null;
};

export type EditorApiService = {
  readonly getSession: () => Promise<SessionInfo>;
  readonly createSession: (userId: string) => Promise<SessionInfo>;
  readonly deleteSession: () => Promise<void>;
  readonly loadViewport: (
    bbox: readonly [number, number, number, number],
  ) => Promise<components["schemas"]["Viewport"]>;
  readonly listChangesets: (input: {
    readonly beforeId?: number | undefined;
    readonly limit: number;
  }) => Promise<ChangesetListPage>;
  readonly save: (
    payload: ChangesetUploadPayload,
    comment: string | null,
  ) => Promise<ChangesetUploadDiffResult>;
};

export const createEditorApi = (baseUrl: string, worldSlug: string): EditorApiService => {
  const client = createClient<paths>({
    baseUrl: `${baseUrl.replace(/\/$/, "")}/api`,
    credentials: "include",
  });

  const save: EditorApiService["save"] = async (payload, comment) => {
    const changesetResult = await client.POST("/worlds/{worldSlug}/changesets", {
      params: { path: { worldSlug } },
      body: { comment: comment ?? undefined },
    });
    const changeset = await json<Changeset>(changesetResult);
    const changesetId = changeset.id;
    const nodeIds = new Map<number, { id: number; version: number }>();
    const nodeResults: ChangesetUploadDiffResult["nodes"][number][] = [];
    const wayResults: ChangesetUploadDiffResult["ways"][number][] = [];
    const remapNode = (id: number) => nodeIds.get(id)?.id ?? id;

    try {
      for (const node of payload.create.nodes) {
        const result = await client.POST("/worlds/{worldSlug}/nodes", {
          params: { path: { worldSlug } },
          body: { changesetId, geom: node.geom, tags: node.tags },
        });
        const created = await json<IdVersion>(result);
        nodeIds.set(node.id, created);
        nodeResults.push({ oldId: node.id, newId: created.id, newVersion: created.version });
      }
      for (const way of payload.create.ways) {
        const result = await client.POST("/worlds/{worldSlug}/ways", {
          params: { path: { worldSlug } },
          body: {
            changesetId,
            geometryKind: way.geometryKind,
            nodeRefs: way.nodeRefs.map(remapNode),
            tags: way.tags,
          },
        });
        const created = await json<IdVersion>(result);
        wayResults.push({ oldId: way.id, newId: created.id, newVersion: created.version });
      }
      for (const node of payload.modify.nodes) {
        const result = await client.PATCH("/worlds/{worldSlug}/nodes/{id}", {
          params: { path: { worldSlug, id: node.id } },
          body: {
            changesetId,
            expectedVersion: node.expectedVersion,
            geom: node.geom,
            tags: node.tags,
          },
        });
        const updated = await json<IdVersion>(result);
        nodeResults.push({ oldId: node.id, newId: updated.id, newVersion: updated.version });
      }
      for (const way of payload.modify.ways) {
        const result = await client.PATCH("/worlds/{worldSlug}/ways/{id}", {
          params: { path: { worldSlug, id: way.id } },
          body: {
            changesetId,
            expectedVersion: way.expectedVersion,
            geometryKind: way.geometryKind,
            nodeRefs: way.nodeRefs.map(remapNode),
            tags: way.tags,
          },
        });
        const updated = await json<IdVersion>(result);
        wayResults.push({ oldId: way.id, newId: updated.id, newVersion: updated.version });
      }
      for (const way of payload.delete.ways) {
        await noContent(
          await client.DELETE("/worlds/{worldSlug}/ways/{id}", {
            params: { path: { worldSlug, id: way.id } },
            body: { changesetId, expectedVersion: way.expectedVersion },
          }),
        );
      }
      for (const node of payload.delete.nodes) {
        await noContent(
          await client.DELETE("/worlds/{worldSlug}/nodes/{id}", {
            params: { path: { worldSlug, id: node.id } },
            body: { changesetId, expectedVersion: node.expectedVersion },
          }),
        );
      }
      await json<Changeset>(
        await client.POST("/worlds/{worldSlug}/changesets/{id}/publish", {
          params: { path: { worldSlug, id: changesetId } },
        }),
      );
      return { nodes: nodeResults, ways: wayResults, relations: [] };
    } catch (error) {
      try {
        await noContent(
          await client.POST("/worlds/{worldSlug}/changesets/{id}/abandon", {
            params: { path: { worldSlug, id: changesetId } },
          }),
        );
      } catch {
        // Abandon is best effort; preserve the original operation failure.
      }
      throw error;
    }
  };

  return {
    getSession: async () => {
      const session = await json<components["schemas"]["SessionInfo"]>(
        await client.GET("/auth/session"),
      );
      return { user: session.user ?? null };
    },
    createSession: async (userId) => {
      const session = await json<components["schemas"]["SessionInfo"]>(
        await client.POST("/auth/session", { body: { userId } }),
      );
      return { user: session.user ?? null };
    },
    deleteSession: async () => noContent(await client.DELETE("/auth/session")),
    loadViewport: async (bbox) =>
      json<components["schemas"]["Viewport"]>(
        await client.GET("/worlds/{worldSlug}/viewport", {
          params: {
            path: { worldSlug },
            query: { bbox: bbox.join(","), includeRelations: false },
          },
        }),
      ),
    listChangesets: async ({ beforeId, limit }) => {
      const changesets = await json<readonly Changeset[]>(
        await client.GET("/worlds/{worldSlug}/changesets", {
          params: { path: { worldSlug } },
        }),
      );
      const filtered = changesets.filter(
        (changeset) => beforeId === undefined || changeset.id < beforeId,
      );
      const page = filtered.slice(0, limit);
      return {
        changesets: page,
        nextBeforeId: filtered.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
    save,
  };
};
