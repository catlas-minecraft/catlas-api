import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    conditions: ["browser", "development"],
  },
  test: {
    environment: "happy-dom",
    server: {
      deps: {
        inline: ["solid-js", "solid-js/web"],
      },
    },
  },
  pack: {
    entry: ["src/index.ts"],
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
