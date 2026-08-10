import featureDocumentJson from "../features.json" with { type: "json" };
import { createFeatureRegistry } from "./registry.ts";

export const DEFAULT_FEATURE_ICON_IDS = new Set([
  "automatic-storage",
  "base",
  "building",
  "chest",
  "farm",
  "nether-portal",
  "tree-farm",
]);

export const defaultFeatureRegistry = createFeatureRegistry(featureDocumentJson, {
  iconIds: DEFAULT_FEATURE_ICON_IDS,
});
