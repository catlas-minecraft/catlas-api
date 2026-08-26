import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { CatlasApi, Viewport, World } from "@catlas/api-client";
import { QueryClientProvider } from "@tanstack/solid-query";
import { App } from "./app.tsx";
import { LOCALE_STORAGE_KEY } from "./i18n.ts";
import { createViewerQueryClient } from "./query-client.ts";

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

const fakeApi = (overrides: Partial<CatlasApi> = {}): CatlasApi => ({
  listWorlds: vi.fn(async () => [world("main")]),
  getWorld: vi.fn(async (slug) => world(slug)),
  loadViewport: vi.fn(async () => emptyViewport),
  ...overrides,
});

const flush = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

const mount = (api: CatlasApi, initialWorldSlug?: string) => {
  const root = document.createElement("div");
  document.body.append(root);
  const queryClient = createViewerQueryClient();
  const [worldSlug, setWorldSlug] = createSignal(initialWorldSlug);
  const navigateWorld = vi.fn((slug: string | undefined) => setWorldSlug(slug));
  const dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <App api={api} navigateWorld={navigateWorld} worldSlug={worldSlug} />
      </QueryClientProvider>
    ),
    root,
  );
  return { dispose, navigateWorld, root, worldSlug };
};

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  document.documentElement.lang = "en";
});

describe("viewer UI", () => {
  test("announces the loading state while worlds are pending", async () => {
    const api = fakeApi({
      listWorlds: vi.fn(() => new Promise<World[]>(() => undefined)),
    });
    const { dispose, root } = mount(api);

    await flush();

    expect(root.querySelector('[role="status"]')?.textContent).toContain("Loading worlds");
    dispose();
  });

  test("shows an actionable error when the world list fails", async () => {
    const api = fakeApi({
      listWorlds: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const { dispose, root } = mount(api);

    await flush();

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      "Worlds could not be loaded",
    );
    expect(root.querySelector('.viewer-message button[type="button"]')?.textContent).toBe("Retry");
    dispose();
  });

  test("retries the world query from the error action", async () => {
    const listWorlds = vi
      .fn<CatlasApi["listWorlds"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([world("main")]);
    const { dispose, root } = mount(fakeApi({ listWorlds }));

    await flush();
    const retry = root.querySelector<HTMLButtonElement>('.viewer-message button[type="button"]');
    if (!retry) throw new Error("Retry button was not rendered");
    retry.click();
    await flush();
    await flush();

    expect(listWorlds).toHaveBeenCalledTimes(2);
    expect(root.querySelector('option[value="main"]')).toBeTruthy();
    dispose();
  });

  test("handles an empty world list without rendering a map", async () => {
    const api = fakeApi({ listWorlds: vi.fn(async () => []) });
    const { dispose, root } = mount(api);

    await flush();

    expect(root.textContent).toContain("No worlds are available yet");
    expect(root.querySelector(".catlas-map")).toBeNull();
    dispose();
  });

  test("reports an invalid world and keeps native controls named", async () => {
    const { dispose, root } = mount(fakeApi(), "missing");

    await flush();

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      "This world is not available",
    );
    expect(root.querySelector('select[aria-label="World"]')).toBeTruthy();
    expect(root.querySelector('select[aria-label="Language"]')).toBeTruthy();
    dispose();
  });

  test("restores and persists the locale without adding a language query", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "ja");
    const { dispose, root } = mount(fakeApi({ listWorlds: vi.fn(async () => []) }));

    await flush();

    const language = root.querySelector<HTMLSelectElement>('select[aria-label="言語"]');
    expect(language?.value).toBe("ja");
    expect(document.documentElement.lang).toBe("ja");
    if (!language) throw new Error("Language control was not rendered");
    language.value = "en";
    language.dispatchEvent(new Event("change", { bubbles: true }));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    expect(new URL(window.location.href).searchParams.has("lang")).toBe(false);
    dispose();
  });
});
