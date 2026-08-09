import { describe, expect, test } from "vite-plus/test";
import { areaInteriorAnchor, type FeatureCoordinate } from "../src/catlas/feature-geometry";

const containsPoint = (polygon: readonly FeatureCoordinate[], point: FeatureCoordinate) => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [lat, lng] = polygon[index]!;
    const [previousLat, previousLng] = polygon[previous]!;
    if (
      lng > point[1] !== previousLng > point[1] &&
      point[0] < ((previousLat - lat) * (point[1] - lng)) / (previousLng - lng) + lat
    ) {
      inside = !inside;
    }
  }
  return inside;
};

describe("feature geometry", () => {
  test("places an area anchor inside a concave polygon", () => {
    const polygon: FeatureCoordinate[] = [
      [0, 0],
      [0, 4],
      [4, 4],
      [4, 3],
      [1, 3],
      [1, 1],
      [4, 1],
      [4, 0],
    ];

    expect(containsPoint(polygon, areaInteriorAnchor(polygon))).toBe(true);
  });
});
