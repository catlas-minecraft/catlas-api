import type { BBox, CatlasApi, Viewport } from "@catlas/api-client";

type PreviousQuery = {
  readonly queryKey: readonly unknown[];
};

export const createWorldsQueryOptions = (api: CatlasApi) => ({
  queryKey: ["worlds"] as const,
  queryFn: ({ signal }: { readonly signal: AbortSignal }) => api.listWorlds({ signal }),
  staleTime: 60_000,
});

export const createViewportQueryOptions = (
  api: CatlasApi,
  worldSlug: string | undefined,
  bbox: BBox | undefined,
) => ({
  queryKey: ["viewport", worldSlug, bbox] as const,
  enabled: Boolean(worldSlug && bbox),
  queryFn: ({ signal }: { readonly signal: AbortSignal }) => {
    if (!worldSlug || !bbox) throw new Error("Viewport query is not enabled.");
    return api.loadViewport(worldSlug, bbox, { signal });
  },
  placeholderData: (previousData: Viewport | undefined, previousQuery: PreviousQuery | undefined) =>
    previousQuery?.queryKey[1] === worldSlug ? previousData : undefined,
  staleTime: 10_000,
});
