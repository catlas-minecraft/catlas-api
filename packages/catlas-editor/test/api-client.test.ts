import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { Graph } from "../src/lib/graph";
import { createEditorApi } from "../src/lib/editor/api-client";
import { toChangesetUpload } from "../src/lib/editor/changeset";
import { line, node } from "./helpers";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const requestDetails = async (call: readonly unknown[]) => {
  const input = call[0];
  if (input instanceof Request) {
    const text = input.method === "GET" ? "" : await input.clone().text();
    return {
      url: input.url,
      body: text ? JSON.parse(text) : undefined,
    };
  }
  const init = call[1] as RequestInit | undefined;
  return {
    url: String(input),
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
  };
};

describe("editor API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("uploads the changeset in one request before publishing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 42 }))
      .mockResolvedValueOnce(
        jsonResponse({
          nodes: [{ oldId: -1, newId: 101, newVersion: 1 }],
          ways: [{ oldId: -1, newId: 201, newVersion: 1 }],
          relations: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const payload = toChangesetUpload(
      new Graph(),
      new Graph([node(-1), node(-2), line(-1, [-1, -2])]),
    );
    const result = await createEditorApi("https://example.test", "demo").save(payload, "bulk");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const requests = await Promise.all(fetchMock.mock.calls.map(requestDetails));
    expect(requests.map((request) => request.url)).toEqual([
      "https://example.test/api/worlds/demo/changesets",
      "https://example.test/api/worlds/demo/changesets/42/upload",
      "https://example.test/api/worlds/demo/changesets/42/publish",
    ]);
    expect(requests[1]?.body).toEqual(payload);
    expect(result.nodes).toEqual([{ oldId: -1, newId: 101, newVersion: 1 }]);
  });

  test("abandons the changeset when bulk upload fails", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 42 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "invalid upload" }), { status: 422 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = toChangesetUpload(new Graph(), new Graph([node(-1)]));
    await expect(
      createEditorApi("https://example.test", "demo").save(payload, null),
    ).rejects.toThrow("invalid upload");

    const requests = await Promise.all(fetchMock.mock.calls.map(requestDetails));
    expect(requests.map((request) => request.url)).toEqual([
      "https://example.test/api/worlds/demo/changesets",
      "https://example.test/api/worlds/demo/changesets/42/upload",
      "https://example.test/api/worlds/demo/changesets/42/abandon",
    ]);
  });
});
