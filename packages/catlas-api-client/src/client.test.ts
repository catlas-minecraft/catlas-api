import { describe, expect, test, vi } from "vite-plus/test";
import { CatlasApiError, CatlasNetworkError, createCatlasApi } from "./client.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });

describe("Catlas API client", () => {
  test("loads worlds from the configured API base URL", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.url).toBe("https://catlas.test/api/worlds");
      expect(request.credentials).toBe("include");
      return jsonResponse([]);
    });
    const api = createCatlasApi({
      baseUrl: "https://catlas.test/api",
      credentials: "include",
      fetch: fetcher,
    });

    await expect(api.listWorlds()).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("encodes world slugs and sends the viewport bbox without relations", async () => {
    let receivedRequest: Request | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      receivedRequest = input instanceof Request ? input : new Request(input, init);
      return jsonResponse({
        nodes: [],
        ways: [],
        wayNodes: [],
        relations: [],
        relationMembers: [],
      });
    });
    const api = createCatlasApi({ baseUrl: "https://catlas.test/api", fetch: fetcher });
    const controller = new AbortController();
    const signal = controller.signal;

    await api.loadViewport("sky islands", [-12, -4, 20, 24], { signal });

    expect(receivedRequest).toBeDefined();
    const url = new URL(receivedRequest!.url);
    expect(url.pathname).toBe("/api/worlds/sky%20islands/viewport");
    expect(url.searchParams.get("bbox")).toBe("-12,-4,20,24");
    expect(url.searchParams.get("includeRelations")).toBe("false");
    expect(receivedRequest!.signal.aborted).toBe(false);
    controller.abort();
    expect(receivedRequest!.signal.aborted).toBe(true);
  });

  test("normalizes HTTP errors with status and server detail", async () => {
    const api = createCatlasApi({
      baseUrl: "https://catlas.test/api",
      fetch: async () => jsonResponse({ message: "World does not exist" }, 404),
    });

    await expect(api.getWorld("missing")).rejects.toMatchObject({
      name: "CatlasApiError",
      status: 404,
      message: "World does not exist",
    });
  });

  test("normalizes network failures while preserving abort errors", async () => {
    const api = createCatlasApi({
      baseUrl: "https://catlas.test/api",
      fetch: async () => {
        throw new Error("offline");
      },
    });

    await expect(api.listWorlds()).rejects.toBeInstanceOf(CatlasNetworkError);

    const controller = new AbortController();
    controller.abort();
    const abortApi = createCatlasApi({
      baseUrl: "https://catlas.test/api",
      fetch: async () => {
        throw new DOMException("aborted", "AbortError");
      },
    });
    await expect(abortApi.listWorlds()).rejects.toMatchObject({ name: "AbortError" });
    expect(new CatlasApiError("test").status).toBe(0);
  });
});
