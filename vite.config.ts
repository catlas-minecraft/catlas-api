import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    ignorePatterns: ["packages/catlas-editor/src/lib/editor/catlas-api.gen.ts"],
    options: { typeAware: true, typeCheck: true },
  },
});
