import { createFeatureRegistry } from "@catlas/features";
import { describe, expect, test } from "vite-plus/test";
import { assignableFeaturesForEntity, featureAssignmentTags } from "../src/lib/editor/features";
import { area, line, node } from "./helpers";
import testFeatureDocument from "../../catlas-features/test/features.json" with { type: "json" };

const testFeatureRegistry = createFeatureRegistry(testFeatureDocument);

describe("feature assignment", () => {
  test("offers only features compatible with the entity geometry", () => {
    expect(
      assignableFeaturesForEntity(testFeatureRegistry, node(1)).map((feature) => feature.id),
    ).toEqual([
      "portal.nether",
      "facility.automatic_storage",
      "facility.storage",
      "facility.farm",
      "facility.tree_farm",
      "place.base",
    ]);
    expect(
      assignableFeaturesForEntity(testFeatureRegistry, area(1, [1, 2, 3, 1])).map(
        (feature) => feature.id,
      ),
    ).toEqual([
      "building.generic",
      "facility.automatic_storage",
      "facility.storage",
      "facility.farm",
      "facility.tree_farm",
      "place.base",
    ]);
    expect(assignableFeaturesForEntity(testFeatureRegistry, line(1, [1, 2]))).toEqual([]);
  });

  test("resolves optional crop and tree tags without requiring them", () => {
    expect(
      testFeatureRegistry.resolve({
        kind: "area",
        tags: { facility: "farm", crop: "wheat" },
      }).primary?.id,
    ).toBe("facility.farm");
    expect(
      testFeatureRegistry.resolve({
        kind: "area",
        tags: { facility: "tree_farm", tree: "oak" },
      }).primary?.id,
    ).toBe("facility.tree_farm");
    expect(
      testFeatureRegistry.resolve({ kind: "area", tags: { facility: "farm" } }).primary?.id,
    ).toBe("facility.farm");
    expect(
      testFeatureRegistry.resolve({ kind: "area", tags: { facility: "tree_farm" } }).primary?.id,
    ).toBe("facility.tree_farm");
  });

  test("round trips each creation tag set to its feature", () => {
    for (const id of ["building.generic", "facility.farm", "facility.tree_farm"] as const) {
      const feature = testFeatureRegistry.featuresById.get(id)!;
      const create = feature.editor!.create!;

      expect(
        testFeatureRegistry.resolve({ kind: create.kind, tags: create.tags }).primary?.id,
      ).toBe(id);
    }
  });

  test("preserves existing tags while applying canonical feature tags", () => {
    const entity = { ...node(1), tags: { facility: "other", name: "Warehouse" } };
    const feature = testFeatureRegistry.featuresById.get("facility.automatic_storage")!;

    expect(featureAssignmentTags(testFeatureRegistry, entity, feature)).toEqual({
      facility: "storage",
      automation: "redstone",
      name: "Warehouse",
    });
  });

  test("removes stale feature tags so the chosen feature wins", () => {
    const entity = { ...node(1), tags: { automation: "redstone", name: "Warehouse" } };
    const feature = testFeatureRegistry.featuresById.get("facility.storage")!;
    const tags = featureAssignmentTags(testFeatureRegistry, entity, feature)!;

    expect(tags).toEqual({ facility: "storage", name: "Warehouse" });
    expect(testFeatureRegistry.resolve({ kind: "node", tags }).primary?.id).toBe(
      "facility.storage",
    );
  });
});
