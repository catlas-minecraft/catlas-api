import type { Point3D, SnapPolicy } from "./types";

export const snapValue = (value: number, policy: SnapPolicy) => {
  if (policy === "integer") return Math.round(value);
  if (policy === "half") return Math.round(value * 2) / 2;
  return value;
};

export const snapPoint = (point: Point3D, policy: SnapPolicy): Point3D => ({
  x: snapValue(point.x, policy),
  y: snapValue(point.y, policy),
  z: snapValue(point.z, policy),
});
