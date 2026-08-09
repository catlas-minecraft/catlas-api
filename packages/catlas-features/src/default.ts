import featureDocumentJson from "../features.json" with { type: "json" };
import { createFeatureRegistry } from "./registry.ts";

export const DEFAULT_FEATURE_ICON_IDS = new Set([
  "automatic-storage",
  "base",
  "chest",
  "nether-portal",
]);

export const defaultFeatureRegistry = createFeatureRegistry(featureDocumentJson, {
  iconIds: DEFAULT_FEATURE_ICON_IDS,
});
