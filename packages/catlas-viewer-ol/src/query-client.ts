import { QueryClient } from "@tanstack/solid-query";

export const createViewerQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: false,
      },
    },
  });
