import { defaultFeatureRegistry } from "@catlas/features";
import { describe, expect, test } from "vite-plus/test";
import { assignableFeaturesForEntity, featureAssignmentTags } from "../src/lib/editor/features";
import { area, line, node } from "./helpers";

describe("feature assignment", () => {
  test("offers only features compatible with the entity geometry", () => {
    expect(
      assignableFeaturesForEntity(defaultFeatureRegistry, node(1)).map((feature) => feature.id),
    ).toEqual(["portal.nether", "facility.automatic_storage", "facility.storage", "place.base"]);
    expect(
      assignableFeaturesForEntity(defaultFeatureRegistry, area(1, [1, 2, 3, 1])).map(
        (feature) => feature.id,
      ),
    ).toEqual(["facility.automatic_storage", "facility.storage", "place.base"]);
    expect(assignableFeaturesForEntity(defaultFeatureRegistry, line(1, [1, 2]))).toEqual([]);
  });

  test("preserves existing tags while applying canonical feature tags", () => {
    const entity = { ...node(1), tags: { facility: "other", name: "Warehouse" } };
    const feature = defaultFeatureRegistry.featuresById.get("facility.automatic_storage")!;

    expect(featureAssignmentTags(defaultFeatureRegistry, entity, feature)).toEqual({
      facility: "storage",
      automation: "redstone",
      name: "Warehouse",
    });
  });

  test("removes stale feature tags so the chosen feature wins", () => {
    const entity = { ...node(1), tags: { automation: "redstone", name: "Warehouse" } };
    const feature = defaultFeatureRegistry.featuresById.get("facility.storage")!;
    const tags = featureAssignmentTags(defaultFeatureRegistry, entity, feature)!;

    expect(tags).toEqual({ facility: "storage", name: "Warehouse" });
    expect(defaultFeatureRegistry.resolve({ kind: "node", tags }).primary?.id).toBe(
      "facility.storage",
    );
  });
});
