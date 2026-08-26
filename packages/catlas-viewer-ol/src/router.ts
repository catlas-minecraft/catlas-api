import { createCatlasApi, type CatlasApi } from "@catlas/api-client";
import { createBrowserHistory, createRouter } from "@tanstack/solid-router";
import { routeTree } from "./routeTree.gen.ts";

export const createViewerRouter = (
  api: CatlasApi = createCatlasApi(),
  history = createBrowserHistory(),
) =>
  createRouter({
    routeTree,
    context: { api },
    defaultPreload: "intent",
    history,
    scrollRestoration: true,
  });

declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof createViewerRouter>;
  }
}
