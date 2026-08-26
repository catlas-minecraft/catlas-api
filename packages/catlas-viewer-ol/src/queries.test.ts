import type { BBox, CatlasApi, Viewport } from "@catlas/api-client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createViewerQueryClient } from "./query-client.ts";
import { createViewportQueryOptions } from "./queries.ts";

const emptyViewport: Viewport = {
  nodes: [],
  ways: [],
  wayNodes: [],
  relations: [],
  relationMembers: [],
};

const bbox: BBox = [-10, -20, 30, 40];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("viewer query options", () => {
  test("caches a viewport by world and bbox", async () => {
    const loadViewport = vi.fn(async () => emptyViewport);
    const api = { loadViewport } as unknown as CatlasApi;
    const queryClient = createViewerQueryClient();

    await queryClient.fetchQuery(createViewportQueryOptions(api, "main", bbox));
    await queryClient.fetchQuery(createViewportQueryOptions(api, "main", bbox));

    expect(loadViewport).toHaveBeenCalledTimes(1);
    expect(loadViewport).toHaveBeenCalledWith("main", bbox, { signal: expect.any(AbortSignal) });
  });

  test("passes query cancellation through to the API signal", async () => {
    let resolveStarted: (signal: AbortSignal) => void = () => undefined;
    const started = new Promise<AbortSignal>((resolve) => {
      resolveStarted = resolve;
    });
    const loadViewport = vi.fn(
      async (_worldSlug: string, _bbox: BBox, options?: { readonly signal?: AbortSignal }) => {
        if (!options?.signal) throw new Error("Missing query signal");
        resolveStarted(options.signal);
        return new Promise<Viewport>(() => undefined);
      },
    );
    const api = { loadViewport } as unknown as CatlasApi;
    const queryClient = createViewerQueryClient();
    const queryKey = ["viewport", "main", bbox] as const;
    const pending = queryClient
      .fetchQuery(createViewportQueryOptions(api, "main", bbox))
      .catch(() => undefined);

    const signal = await started;
    await queryClient.cancelQueries({ queryKey });

    expect(signal.aborted).toBe(true);
    await pending;
  });
});
