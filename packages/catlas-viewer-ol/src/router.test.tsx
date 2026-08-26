import { render } from "solid-js/web";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { CatlasApi, Viewport, World } from "@catlas/api-client";
import { QueryClientProvider } from "@tanstack/solid-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/solid-router";
import { createViewerQueryClient } from "./query-client.ts";
import { createViewerRouter } from "./router.ts";

const emptyViewport: Viewport = {
  nodes: [],
  ways: [],
  wayNodes: [],
  relations: [],
  relationMembers: [],
};

const world = (slug: string): World => ({
  id: slug.length,
  slug,
  name: slug === "main" ? "Main world" : "Second world",
  createdAt: "2025-01-01T00:00:00Z",
  createdBy: { id: 1, userId: "tester", username: "Tester" },
});

const fakeApi = (): CatlasApi => ({
  listWorlds: vi.fn(async () => [world("main"), world("second")]),
  getWorld: vi.fn(async (slug) => world(slug)),
  loadViewport: vi.fn(async () => emptyViewport),
});

const flush = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

const settle = async () => {
  await flush();
  await flush();
  await flush();
};

const url = (href: string) => new URL(href, "http://catlas.test");

const mount = async (api: CatlasApi, initialEntries: string[]) => {
  const history = createMemoryHistory({ initialEntries });
  const router = createViewerRouter(api, history);
  await router.load();
  const root = document.createElement("div");
  document.body.append(root);
  const queryClient = createViewerQueryClient();
  const dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    ),
    root,
  );
  return { dispose, history, root, router };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("viewer router", () => {
  test("selects the world requested by the initial URL", async () => {
    const { dispose, history, root } = await mount(fakeApi(), ["/?world=second"]);

    await settle();

    const worldSelect = root.querySelector<HTMLSelectElement>('select[aria-label="World"]');
    if (!worldSelect) throw new Error("World control was not rendered");
    expect(history.location.href).toContain("world=second");
    expect(worldSelect.value).toBe("second");

    dispose();
  });

  test("replaces the initial world, pushes selections, and supports back/forward", async () => {
    const { dispose, history, root } = await mount(fakeApi(), ["/?foo=bar"]);

    await settle();

    expect(history.length).toBe(1);
    expect(url(history.location.href).searchParams.get("foo")).toBe("bar");
    expect(url(history.location.href).searchParams.get("world")).toBe("main");

    const worldSelect = root.querySelector<HTMLSelectElement>('select[aria-label="World"]');
    if (!worldSelect) throw new Error("World control was not rendered");
    expect(worldSelect.value).toBe("main");

    worldSelect.value = "second";
    worldSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    expect(history.length).toBe(2);
    expect(url(history.location.href).searchParams.get("foo")).toBe("bar");
    expect(url(history.location.href).searchParams.get("world")).toBe("second");

    history.back();
    await settle();
    expect(url(history.location.href).searchParams.get("world")).toBe("main");
    expect(worldSelect.value).toBe("main");

    history.forward();
    await settle();
    expect(url(history.location.href).searchParams.get("world")).toBe("second");
    expect(worldSelect.value).toBe("second");

    dispose();
  });
});
