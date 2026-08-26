import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/solid-router";
import { App } from "../app.tsx";

type ViewerSearch = {
  readonly world?: string;
};

const validateSearch = (search: Record<string, unknown>): ViewerSearch => {
  const world = search.world;
  return {
    world: typeof world === "string" && world.length > 0 ? world : undefined,
  };
};

export const Route = createFileRoute("/")({
  validateSearch,
  search: {
    middlewares: [retainSearchParams(true)],
  },
  component: ViewerRoute,
});

function ViewerRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const routeContext = Route.useRouteContext();

  return (
    <App
      api={routeContext().api}
      navigateWorld={(world, mode) => {
        void navigate({
          replace: mode === "replace",
          search: (previous) => ({ ...previous, world }),
        });
      }}
      worldSlug={() => search().world}
    />
  );
}
