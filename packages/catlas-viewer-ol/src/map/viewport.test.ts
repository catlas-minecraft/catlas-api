import { createFeatureRegistry } from "@catlas/features";
import { describe, expect, test } from "vite-plus/test";
import type { Viewport } from "@catlas/api-client";
import { anchorForPath, labelWidth, labelsWithoutCollisions, projectViewport } from "./viewport.ts";

const registry = createFeatureRegistry({
  schemaVersion: "1.0.0",
  defaultLocale: "en",
  categories: [{ id: "test", displayName: { en: "Test", ja: "テスト" } }],
  features: [
    {
      id: "test.place",
      displayName: { en: "Place", ja: "場所" },
      category: "test",
      appliesTo: ["node"],
      match: { tags: { amenity: "place" } },
      viewer: {
        minZoom: 0,
        label: { tag: "name", minZoom: 0, collisionPriority: 10 },
      },
    },
    {
      id: "test.hidden",
      displayName: { en: "Hidden", ja: "非表示" },
      category: "test",
      appliesTo: ["node"],
      match: { tags: { amenity: "hidden" } },
      viewer: { minZoom: 4 },
    },
    {
      id: "test.road",
      displayName: { en: "Road", ja: "道" },
      category: "test",
      appliesTo: ["line"],
      match: { tags: { highway: "path" } },
      viewer: {
        minZoom: 0,
        label: { tag: "name", minZoom: 0, collisionPriority: 4 },
      },
    },
  ],
});

const node = (
  id: number,
  x: number,
  z: number,
  tags: Record<string, string>,
  deletedAt: string | null = null,
) => ({
  id,
  version: 1,
  geom: { x, y: 0, z },
  tags,
  deletedAt,
  changesetId: 1,
});

const viewport: Viewport = {
  nodes: [
    node(1, 0, 0, { amenity: "place", "name:en": "Square", "name:ja": "広場" }),
    node(2, 10, 0, {}, null),
    node(3, 20, 0, { amenity: "hidden", name: "Too far in" }),
    node(4, 5, 5, { amenity: "place", name: "Deleted" }, "2025-01-01T00:00:00Z"),
    node(5, 100, 100, { amenity: "place", name: "Outside" }),
  ],
  ways: [
    {
      id: 10,
      version: 1,
      geometryKind: "line",
      tags: { highway: "path", name: "Trail" },
      isClosed: false,
      deletedAt: null,
      changesetId: 1,
    },
  ],
  wayNodes: [
    { wayId: 10, seq: 0, nodeId: 1, changesetId: 1 },
    { wayId: 10, seq: 1, nodeId: 2, changesetId: 1 },
  ],
  relations: [],
  relationMembers: [],
};

describe("viewport projection", () => {
  test("keeps stable path anchors and projects world coordinates", () => {
    expect(
      anchorForPath(
        [
          [0, 0],
          [-10, 0],
        ],
        "line",
      ),
    ).toEqual([-5, 0]);
    expect(
      anchorForPath(
        [
          [0, 0],
          [-10, 0],
          [-10, -10],
          [0, -10],
        ],
        "area",
      ),
    ).toEqual([-5, -5]);
  });

  test("filters deleted, outside, hidden, and way-owned unknown nodes", () => {
    const result = projectViewport(viewport, [-10, -10, 30, 30], 0, "en", registry);
    expect(result.polylines.map((path) => path.id)).toEqual([10]);
    expect(result.markers.map((marker) => marker.id)).toEqual([1]);
    expect(result.polylines[0]?.coordinates).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  test("uses locale-specific label tags and accessible names", () => {
    const result = projectViewport(viewport, [-10, -10, 30, 30], 0, "ja", registry);
    expect(result.markers[0]?.accessibleName).toBe("場所: 広場");
    expect(result.labels.map((label) => label.text)).toContain("広場");
    expect(result.labels.map((label) => label.text)).toContain("Trail");
  });

  test("prefers higher collision priority deterministically", () => {
    const candidates = [
      {
        key: "low",
        coordinate: [50, 50] as [number, number],
        text: "low",
        displayText: "low",
        priority: 1,
        width: labelWidth("low"),
      },
      {
        key: "high",
        coordinate: [50, 50] as [number, number],
        text: "high",
        displayText: "high",
        priority: 2,
        width: labelWidth("high"),
      },
    ];
    expect(
      labelsWithoutCollisions(candidates, {
        mapSize: [100, 100],
        coordinateToPixel: (coordinate) => coordinate,
      }).map((candidate) => candidate.key),
    ).toEqual(["high"]);
  });
});
