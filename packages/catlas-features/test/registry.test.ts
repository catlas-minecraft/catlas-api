import { describe, expect, test } from "vite-plus/test";
import {
  createFeatureRegistry,
  FEATURE_FIELD_UNSET_VALUE,
  FeatureRegistryError,
  resolveLocalizedText,
} from "../src/index.ts";
import testFeatureDocument from "./features.json" with { type: "json" };

const testFeatureRegistry = createFeatureRegistry(testFeatureDocument);

const documentWith = (features: readonly Record<string, unknown>[]) => ({
  schemaVersion: "1.0.0",
  defaultLocale: "en",
  categories: [{ id: "test", displayName: { en: "Test" } }],
  features,
});

const feature = (id: string, tags: Readonly<Record<string, string>>, priority?: number) => ({
  id,
  displayName: { en: id },
  category: "test",
  appliesTo: ["node"],
  match: {
    ...(priority === undefined ? {} : { priority }),
    tags,
  },
});

describe("feature registry", () => {
  test("resolves a more specific feature before its generic feature", () => {
    const resolution = testFeatureRegistry.resolve({
      kind: "node",
      tags: { facility: "storage", automation: "redstone", name: "Warehouse" },
    });

    expect(resolution.primary?.id).toBe("facility.automatic_storage");
    expect(resolution.matches.map((match) => match.id)).toEqual([
      "facility.automatic_storage",
      "facility.storage",
    ]);
    expect(resolution.ambiguous).toBe(false);
  });

  test("resolves building=yes only for areas", () => {
    expect(
      testFeatureRegistry.resolve({ kind: "area", tags: { building: "yes" } }).primary?.id,
    ).toBe("building.generic");
    expect(testFeatureRegistry.resolve({ kind: "node", tags: { building: "yes" } }).primary).toBe(
      null,
    );
  });

  test("uses priority before matcher specificity", () => {
    const registry = createFeatureRegistry(
      documentWith([
        feature("test.broad", { kind: "one" }, 10),
        feature("test.specific", { kind: "one", detail: "two" }),
      ]),
    );

    expect(
      registry.resolve({ kind: "node", tags: { kind: "one", detail: "two" } }).primary?.id,
    ).toBe("test.broad");
  });

  test("reports equal-ranked matches while keeping declaration order deterministic", () => {
    const registry = createFeatureRegistry(
      documentWith([
        feature("test.first", { first: "yes" }),
        feature("test.second", { second: "yes" }),
      ]),
    );
    const resolution = registry.resolve({
      kind: "node",
      tags: { first: "yes", second: "yes" },
    });

    expect(resolution.primary?.id).toBe("test.first");
    expect(resolution.ambiguous).toBe(true);
    expect(registry.diagnostics).toEqual([
      expect.objectContaining({ code: "ambiguous-matchers", severity: "warning" }),
    ]);
  });

  test("returns an explicit unknown result", () => {
    expect(testFeatureRegistry.resolve({ kind: "node", tags: {} })).toEqual({
      primary: null,
      matches: [],
      ambiguous: false,
    });
  });

  test("rejects creation tags that do not satisfy the matcher", () => {
    const input = documentWith([
      {
        ...feature("test.created", { kind: "created" }),
        editor: {
          create: { kind: "node", tags: { kind: "other" } },
        },
      },
    ]);

    expect(() => createFeatureRegistry(input)).toThrow(FeatureRegistryError);
  });

  test("rejects unknown properties", () => {
    expect(() => createFeatureRegistry({ ...documentWith([]), unsupportedProperty: true })).toThrow(
      /Unknown property/,
    );
  });

  test("falls back from a regional locale to its base locale", () => {
    expect(resolveLocalizedText({ en: "Portal", ja: "ポータル" }, "ja-JP", "en")).toBe("ポータル");
  });

  test("does not resolve prototype-inherited tag values", () => {
    const registry = createFeatureRegistry(
      documentWith([feature("test.prototype", { toString: "inherited" })]),
    );

    expect(registry.resolve({ kind: "node", tags: {} }).primary).toBeNull();
    expect(resolveLocalizedText({ en: "Fallback" }, "toString", "en")).toBe("Fallback");
  });

  test("rejects contradictory required select fields", () => {
    const input = documentWith([
      {
        ...feature("test.required", { kind: "required" }),
        editor: {
          fields: [
            {
              type: "select",
              tag: "access",
              label: { en: "Access" },
              required: true,
              allowUnset: true,
              options: [{ value: "yes", label: { en: "Yes" } }],
            },
          ],
        },
      },
    ]);

    expect(() => createFeatureRegistry(input)).toThrow(/cannot allow an unset value/);
  });

  test("rejects the editor's reserved unset value", () => {
    const input = documentWith([
      {
        ...feature("test.unset", { kind: "unset" }),
        editor: {
          fields: [
            {
              type: "select",
              tag: "access",
              label: { en: "Access" },
              options: [{ value: FEATURE_FIELD_UNSET_VALUE, label: { en: "Reserved" } }],
            },
          ],
        },
      },
    ]);

    expect(() => createFeatureRegistry(input)).toThrow(/reserved by the editor/);
  });
});
