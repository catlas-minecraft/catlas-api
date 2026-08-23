import createClient from "openapi-fetch";
import type { components, paths } from "@catlas/api-client";
import { json, noContent } from "../api-response";
import type { ChangesetUploadDiffResult, ChangesetUploadPayload } from "./changeset";

type SessionInfo = { readonly user: components["schemas"]["User"] | null };
type AuthConfig = components["schemas"]["AuthConfigInfo"];
type Changeset = components["schemas"]["Changeset"];

export type ChangesetListPage = {
  readonly changesets: readonly Changeset[];
  readonly nextBeforeId: number | null;
};

export type EditorApiService = {
  readonly getSession: () => Promise<SessionInfo>;
  readonly getAuthConfig: () => Promise<AuthConfig>;
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

    try {
      const uploadResult = await client.POST("/worlds/{worldSlug}/changesets/{id}/upload", {
        params: { path: { worldSlug, id: changesetId } },
        body: payload,
      });
      const diff = await json<ChangesetUploadDiffResult>(uploadResult);
      await json<Changeset>(
        await client.POST("/worlds/{worldSlug}/changesets/{id}/publish", {
          params: { path: { worldSlug, id: changesetId } },
        }),
      );
      return diff;
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
    getAuthConfig: async () =>
      json<components["schemas"]["AuthConfigInfo"]>(await client.GET("/auth/config")),
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
