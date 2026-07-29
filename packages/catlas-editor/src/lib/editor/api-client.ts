import type {
  ChangesetListPage,
  ChangesetUploadDiffResult,
  ChangesetUploadPayload,
} from "@catlas/domain";
import createClient from "openapi-fetch";
import type { components, paths } from "./catlas-api.gen";

type SessionInfo = { readonly username: string | null };
type IdVersion = components["schemas"]["IdVersion"];
type Changeset = components["schemas"]["Changeset"];
type DiffEntry = { readonly oldId: number; readonly newId: number; readonly newVersion: number };

const responseError = async (response: Response, error: unknown) => {
  let detail = "";
  if (error !== undefined) {
    detail = typeof error === "string" ? error : JSON.stringify(error);
  } else {
    const text = await response.text();
    if (text) {
      try {
        const body: unknown = JSON.parse(text);
        detail =
          typeof body === "object" && body !== null && "message" in body
            ? String(body.message)
            : text;
      } catch {
        detail = text;
      }
    }
  }
  return new Error(
    detail || `API request failed (${response.status} ${response.statusText || "Unknown error"}).`,
    { cause: response },
  );
};

const json = async <T>(result: { data?: T; error?: unknown; response: Response }): Promise<T> => {
  if (!result.response.ok) throw await responseError(result.response, result.error);
  if (result.error !== undefined || result.data === undefined) {
    throw await responseError(result.response, result.error);
  }
  return result.data;
};

const noContent = async (result: { error?: unknown; response: Response }) => {
  if (!result.response.ok || result.error !== undefined) {
    throw await responseError(result.response, result.error);
  }
};

export type EditorApiService = {
  readonly getSession: () => Promise<SessionInfo>;
  readonly createSession: (username: string) => Promise<SessionInfo>;
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

export const createEditorApi = (baseUrl: string): EditorApiService => {
  const client = createClient<paths>({
    baseUrl: `${baseUrl.replace(/\/$/, "")}/api`,
    credentials: "include",
  });

  const save: EditorApiService["save"] = async (payload, comment) => {
    const changesetResult = await client.POST("/changesets", {
      body: { comment: comment ?? undefined },
    });
    const changeset = await json<Changeset>(changesetResult);
    const changesetId = changeset.id;
    const nodeIds = new Map<number, { id: number; version: number }>();
    const nodeResults: DiffEntry[] = [];
    const wayResults: DiffEntry[] = [];
    const remapNode = (id: number) => nodeIds.get(id)?.id ?? id;

    try {
      for (const node of payload.create.nodes) {
        const result = await client.POST("/nodes", {
          body: { changesetId, geom: node.geom, featureType: node.featureType, tags: node.tags },
        });
        const created = await json<IdVersion>(result);
        nodeIds.set(node.id, created);
        nodeResults.push({ oldId: node.id, newId: created.id, newVersion: created.version });
      }
      for (const way of payload.create.ways) {
        const result = await client.POST("/ways", {
          body: {
            changesetId,
            featureType: way.featureType,
            geometryKind: way.geometryKind,
            nodeRefs: way.nodeRefs.map(remapNode),
            tags: way.tags,
          },
        });
        const created = await json<IdVersion>(result);
        wayResults.push({ oldId: way.id, newId: created.id, newVersion: created.version });
      }
      for (const node of payload.modify.nodes) {
        const result = await client.PATCH("/nodes/{id}", {
          params: { path: { id: node.id } },
          body: {
            changesetId,
            expectedVersion: node.expectedVersion,
            geom: node.geom,
            featureType: node.featureType,
            tags: node.tags,
          },
        });
        const updated = await json<IdVersion>(result);
        nodeResults.push({ oldId: node.id, newId: updated.id, newVersion: updated.version });
      }
      for (const way of payload.modify.ways) {
        const result = await client.PATCH("/ways/{id}", {
          params: { path: { id: way.id } },
          body: {
            changesetId,
            expectedVersion: way.expectedVersion,
            featureType: way.featureType,
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
          await client.DELETE("/ways/{id}", {
            params: { path: { id: way.id } },
            body: { changesetId, expectedVersion: way.expectedVersion },
          }),
        );
      }
      for (const node of payload.delete.nodes) {
        await noContent(
          await client.DELETE("/nodes/{id}", {
            params: { path: { id: node.id } },
            body: { changesetId, expectedVersion: node.expectedVersion },
          }),
        );
      }
      await json<Changeset>(
        await client.POST("/changesets/{id}/publish", {
          params: { path: { id: changesetId } },
        }),
      );
      return { nodes: nodeResults, ways: wayResults, relations: [] };
    } catch (error) {
      try {
        await noContent(
          await client.POST("/changesets/{id}/abandon", { params: { path: { id: changesetId } } }),
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
      return { username: session.username ?? null };
    },
    createSession: async (username) => {
      const session = await json<components["schemas"]["SessionInfo"]>(
        await client.POST("/auth/session", { body: { username } }),
      );
      return { username: session.username ?? null };
    },
    deleteSession: async () => noContent(await client.DELETE("/auth/session")),
    loadViewport: async (bbox) =>
      json<components["schemas"]["Viewport"]>(
        await client.GET("/viewport", {
          params: { query: { bbox: bbox.join(","), includeRelations: false } },
        }),
      ),
    listChangesets: async ({ beforeId, limit }) => {
      const changesets = await json<readonly Changeset[]>(await client.GET("/changesets"));
      const filtered = changesets.filter(
        (changeset) => beforeId === undefined || changeset.id < beforeId,
      );
      const page = filtered.slice(0, limit);
      return {
        changesets: page.map((changeset) => ({
          id: changeset.id,
          status: changeset.status,
          comment: changeset.comment ?? null,
          createdBy: changeset.createdBy,
          createdAt: Date.parse(changeset.createdAt),
          publishedAt: changeset.publishedAt ? Date.parse(changeset.publishedAt) : null,
        })),
        nextBeforeId: filtered.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
    save,
  };
};
