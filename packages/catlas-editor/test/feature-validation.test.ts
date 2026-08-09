import { createFeatureRegistry } from "@catlas/features";
import { describe, expect, test } from "vite-plus/test";
import { validateFeatureFields } from "../src/lib/editor/validation";
import { Graph } from "../src/lib/graph";
import { node } from "./helpers";

const registry = createFeatureRegistry({
  schemaVersion: "1.0.0",
  defaultLocale: "en",
  categories: [{ id: "place", displayName: { en: "Place" } }],
  features: [
    {
      id: "place.base",
      displayName: { en: "Base" },
      category: "place",
      appliesTo: ["node"],
      match: { tags: { place: "base" } },
      editor: {
        fields: [{ type: "text", tag: "name", label: { en: "Name" }, required: true }],
      },
    },
  ],
});

describe("feature field validation", () => {
  test("requires configured tags on resolved features", () => {
    const entity = { ...node(1), tags: { place: "base" } };

    expect(validateFeatureFields(new Graph([entity]), registry)).toEqual([
      expect.objectContaining({
        severity: "error",
        message: "name is required for place.base.",
        entity: { type: "node", id: 1 },
      }),
    ]);
  });

  test("accepts a populated required field", () => {
    const entity = { ...node(1), tags: { place: "base", name: "Home" } };

    expect(validateFeatureFields(new Graph([entity]), registry)).toEqual([]);
  });
});
