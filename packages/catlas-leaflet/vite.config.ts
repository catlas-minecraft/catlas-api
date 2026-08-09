import { defineConfig } from "vite-plus";

export default defineConfig({
  server: {
    host: process.env.HOST,
    port: Number(process.env.PORT),
  },
  pack: {
    entry: ["src/index.ts"],
    deps: {
      alwaysBundle: ["@catlas/features"],
    },
    dts: true,
    exports: {
      customExports: {
        "./styles.css": "./src/catlas/features.css",
      },
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
