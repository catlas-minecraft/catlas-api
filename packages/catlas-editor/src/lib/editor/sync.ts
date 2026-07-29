import type { ChangesetUploadPayload } from "@catlas/domain";
import type { Graph } from "../graph";
import type { EditorApiService } from "./api-client";
import { diffResultToRemaps } from "./changeset";
import { viewportToEntities } from "./types";

export const loadViewportEntities = (
  api: EditorApiService,
  bbox: readonly [number, number, number, number],
) => api.loadViewport(bbox).then(viewportToEntities);

export const saveGraph = (
  api: EditorApiService,
  current: Graph,
  payload: ChangesetUploadPayload,
  comment: string | null,
) =>
  api.save(payload, comment).then((result) => {
    const remaps = diffResultToRemaps(result);
    return {
      graph: current.remapIds(remaps),
      remaps,
    };
  });
