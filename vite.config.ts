import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    ignorePatterns: ["packages/catlas-api-client/src/generated.ts", ".opencode/"],
    options: { typeAware: true, typeCheck: true },
  },
});
