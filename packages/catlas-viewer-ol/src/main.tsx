import { QueryClientProvider } from "@tanstack/solid-query";
import { RouterProvider } from "@tanstack/solid-router";
import { render } from "solid-js/web";
import { createViewerQueryClient } from "./query-client.ts";
import { createViewerRouter } from "./router.ts";
import "../styled-system/styles.css";
import "./style.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Viewer root element was not found.");

const queryClient = createViewerQueryClient();
const router = createViewerRouter();

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  ),
  root,
);
