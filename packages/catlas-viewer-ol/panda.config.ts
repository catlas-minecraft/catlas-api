import { defineConfig } from "@pandacss/dev";
import { createPreset } from "@park-ui/panda-preset";
import accentColor from "@park-ui/panda-preset/colors/teal";
import grayColor from "@park-ui/panda-preset/colors/slate";

export default defineConfig({
  presets: [
    createPreset({
      accentColor,
      grayColor,
      radius: "md",
    }),
  ],
  preflight: true,
  include: ["./src/**/*.{ts,tsx}"],
  jsxFramework: "solid",
  staticCss: {
    recipes: "*",
  },
});
