import { describe, expect, test } from "vite-plus/test";
import { snapPoint, snapValue } from "../src/lib/editor/snapping";

describe("geometry snapping", () => {
  test("supports integer, half, and free policies", () => {
    expect(snapValue(1.24, "integer")).toBe(1);
    expect(snapValue(1.24, "half")).toBe(1);
    expect(snapValue(1.26, "half")).toBe(1.5);
    expect(snapValue(1.26, "free")).toBe(1.26);
    expect(snapPoint({ x: 1.6, y: 2.4, z: -1.6 }, "integer")).toEqual({ x: 2, y: 2, z: -2 });
  });
});
