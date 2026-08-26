import { defineConfig } from "vite-plus";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  server: {
    host: process.env.HOST,
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/tiles": {
        target: "http://viewer.catlas.localhost:1355",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    tanstackRouter({
      target: "solid",
      autoCodeSplitting: true,
      quoteStyle: "double",
      semicolons: true,
    }),
    solid(),
  ],
  test: {
    environment: "happy-dom",
    server: {
      deps: {
        inline: [
          "@tanstack/history",
          "@tanstack/router-core",
          "@tanstack/solid-query",
          "@tanstack/solid-router",
          "@solid-primitives/refs",
          "@solid-primitives/utils",
          "@solidjs/meta",
          "@ark-ui/solid",
          "@ark-ui/solid/select",
          "@zag-js/select",
          "@zag-js/solid",
          "lucide-solid",
          "solid-js",
          "solid-js/web",
        ],
      },
    },
  },
});
