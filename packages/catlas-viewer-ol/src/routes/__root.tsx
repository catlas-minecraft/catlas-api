import { Outlet, createRootRouteWithContext } from "@tanstack/solid-router";
import type { CatlasApi } from "@catlas/api-client";

export type ViewerRouterContext = {
  readonly api: CatlasApi;
};

export const Route = createRootRouteWithContext<ViewerRouterContext>()({
  component: () => <Outlet />,
});
