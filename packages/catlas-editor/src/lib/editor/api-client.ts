import type {
  ChangesetListPage,
  ChangesetUploadDiffResult,
  ChangesetUploadPayload,
  ViewportSnapshot,
} from "@catlas/domain";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "@effect/platform";
import { Context, Effect, Layer } from "effect";

type SessionInfo = { readonly username: string | null };
type IdVersion = { readonly id: number; readonly version: number };
type RustChangeset = {
  readonly id: number;
  readonly status: "open" | "published" | "abandoned";
  readonly comment: string | null;
  readonly createdBy: string;
};

export class EditorApiError extends Error {
  readonly _tag = "EditorApiError";

  constructor(
    message: string,
    readonly conflict: boolean,
    readonly unauthorized: boolean,
    readonly cause: unknown,
  ) {
    super(message);
    this.name = "EditorApiError";
  }
}

export const toEditorApiError = (cause: unknown) => {
  if (cause instanceof EditorApiError) return cause;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
  const message =
    typeof cause === "object" && cause !== null && "message" in cause
      ? String(cause.message)
      : code || "The API request failed.";
  return new EditorApiError(
    message,
    [
      "version_conflict",
      "changeset_not_open",
      "invalid_topology",
      "invalid_geometry_state",
    ].includes(code),
    code === "unauthorized",
    cause,
  );
};

export type EditorApiService = {
  readonly getSession: () => Effect.Effect<SessionInfo, EditorApiError>;
  readonly createSession: (username: string) => Effect.Effect<SessionInfo, EditorApiError>;
  readonly deleteSession: () => Effect.Effect<void, EditorApiError>;
  readonly loadViewport: (
    bbox: readonly [number, number, number, number],
  ) => Effect.Effect<ViewportSnapshot, EditorApiError>;
  readonly listChangesets: (input: {
    readonly beforeId?: number | undefined;
    readonly limit: number;
  }) => Effect.Effect<ChangesetListPage, EditorApiError>;
  readonly save: (
    payload: ChangesetUploadPayload,
    comment: string | null,
  ) => Effect.Effect<ChangesetUploadDiffResult, EditorApiError>;
};

export class EditorApi extends Context.Tag("@catlas/editor/EditorApi")<
  EditorApi,
  EditorApiService
>() {}

const decodeError = (response: HttpClientResponse.HttpClientResponse) =>
  response.text.pipe(
    Effect.orElseSucceed(() => ""),
    Effect.flatMap((text) => {
      let body: { readonly code?: unknown; readonly message?: unknown } = {};
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        // Use the status fallback below for non-JSON proxy responses.
      }
      const code =
        typeof body.code === "string"
          ? body.code
          : response.status === 401
            ? "unauthorized"
            : response.status === 409
              ? "version_conflict"
              : response.status === 422
                ? "invalid_topology"
                : "request_failed";
      const message =
        typeof body.message === "string"
          ? body.message
          : `API request failed (${response.status}).`;
      return Effect.fail(
        new EditorApiError(
          message,
          response.status === 409 || response.status === 422,
          response.status === 401,
          { code, status: response.status },
        ),
      );
    }),
  );

const makeService = (baseUrl: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const root = `${baseUrl.replace(/\/$/, "")}/api`;

    const execute = (request: HttpClientRequest.HttpClientRequest) =>
      client.execute(request).pipe(
        Effect.mapError(toEditorApiError),
        Effect.flatMap((response) =>
          response.status >= 200 && response.status < 300
            ? Effect.succeed(response)
            : decodeError(response),
        ),
      );

    const requestJson = <A>(request: HttpClientRequest.HttpClientRequest) =>
      execute(request).pipe(
        Effect.flatMap((response) => response.json),
        Effect.map((value) => value as A),
        Effect.mapError(toEditorApiError),
      );

    const requestNoContent = (request: HttpClientRequest.HttpClientRequest) =>
      execute(request).pipe(Effect.asVoid, Effect.mapError(toEditorApiError));

    const withJson = (request: HttpClientRequest.HttpClientRequest, body: unknown) =>
      HttpClientRequest.bodyUnsafeJson(request, body);

    const postJson = <A>(path: string, body: unknown) =>
      requestJson<A>(withJson(HttpClientRequest.post(`${root}${path}`), body));
    const patchJson = <A>(path: string, body: unknown) =>
      requestJson<A>(withJson(HttpClientRequest.patch(`${root}${path}`), body));
    const deleteJson = (path: string, body: unknown) =>
      requestNoContent(withJson(HttpClientRequest.del(`${root}${path}`), body));

    const save: EditorApiService["save"] = (payload, comment) =>
      Effect.gen(function* () {
        const changeset = yield* postJson<RustChangeset>("/changesets", { comment });
        const changesetId = changeset.id;
        const nodeIds = new Map<number, IdVersion>();
        const wayIds = new Map<number, IdVersion>();
        const nodeResults: Array<{ oldId: number; newId: number; newVersion: number }> = [];
        const wayResults: Array<{ oldId: number; newId: number; newVersion: number }> = [];
        const remapNode = (id: number) => nodeIds.get(id)?.id ?? id;

        const operation = Effect.gen(function* () {
          for (const node of payload.create.nodes) {
            const created = yield* postJson<IdVersion>("/nodes", {
              changesetId,
              geom: node.geom,
              featureType: node.featureType,
              tags: node.tags,
            });
            nodeIds.set(node.id, created);
            nodeResults.push({ oldId: node.id, newId: created.id, newVersion: created.version });
          }

          for (const way of payload.create.ways) {
            const created = yield* postJson<IdVersion>("/ways", {
              changesetId,
              featureType: way.featureType,
              geometryKind: way.geometryKind,
              nodeRefs: way.nodeRefs.map(remapNode),
              tags: way.tags,
            });
            wayIds.set(way.id, created);
            wayResults.push({ oldId: way.id, newId: created.id, newVersion: created.version });
          }

          for (const node of payload.modify.nodes) {
            const updated = yield* patchJson<IdVersion>(`/nodes/${node.id}`, {
              changesetId,
              expectedVersion: node.expectedVersion,
              geom: node.geom,
              featureType: node.featureType,
              tags: node.tags,
            });
            nodeResults.push({
              oldId: node.id,
              newId: updated.id,
              newVersion: node.expectedVersion + 1,
            });
          }

          for (const way of payload.modify.ways) {
            const updated = yield* patchJson<IdVersion>(`/ways/${way.id}`, {
              changesetId,
              expectedVersion: way.expectedVersion,
              featureType: way.featureType,
              geometryKind: way.geometryKind,
              nodeRefs: way.nodeRefs.map(remapNode),
              tags: way.tags,
            });
            wayResults.push({
              oldId: way.id,
              newId: updated.id,
              newVersion: way.expectedVersion + 1,
            });
          }

          for (const way of payload.delete.ways) {
            yield* deleteJson(`/ways/${way.id}`, {
              changesetId,
              expectedVersion: way.expectedVersion,
            });
          }
          for (const node of payload.delete.nodes) {
            yield* deleteJson(`/nodes/${node.id}`, {
              changesetId,
              expectedVersion: node.expectedVersion,
            });
          }

          yield* postJson<RustChangeset>(`/changesets/${changesetId}/publish`, {});
          return { nodes: nodeResults, ways: wayResults, relations: [] };
        });

        return yield* operation.pipe(
          Effect.onError(() =>
            requestNoContent(
              HttpClientRequest.post(`${root}/changesets/${changesetId}/abandon`),
            ).pipe(Effect.ignore),
          ),
        );
      });

    return {
      getSession: () => requestJson<SessionInfo>(HttpClientRequest.get(`${root}/auth/session`)),
      createSession: (username) => postJson<SessionInfo>("/auth/session", { username }),
      deleteSession: () => requestNoContent(HttpClientRequest.del(`${root}/auth/session`)),
      loadViewport: (bbox) =>
        requestJson<ViewportSnapshot>(
          HttpClientRequest.get(
            `${root}/viewport?bbox=${encodeURIComponent(bbox.join(","))}&includeRelations=false`,
          ),
        ),
      listChangesets: ({ beforeId, limit }) =>
        requestJson<readonly RustChangeset[]>(HttpClientRequest.get(`${root}/changesets`)).pipe(
          Effect.map((changesets) => ({
            changesets: changesets
              .filter((changeset) => beforeId === undefined || changeset.id < beforeId)
              .slice(0, limit)
              .map((changeset) => ({
                ...changeset,
                createdAt: 0,
                publishedAt: null,
              })),
            nextBeforeId: changesets.length > limit ? (changesets[limit - 1]?.id ?? null) : null,
          })),
        ),
      save,
    } satisfies EditorApiService;
  });

export const EditorApiLive = (baseUrl: string) =>
  Layer.effect(EditorApi, makeService(baseUrl)).pipe(Layer.provide(FetchHttpClient.layer));
