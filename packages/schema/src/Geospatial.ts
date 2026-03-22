import { Schema } from "effect";

export const EntityId = Schema.Number.annotations({
  title: "EntityId",
  description: "Numeric identifier for geospatial entities",
});
export type EntityId = typeof EntityId.Type;

export const EntityIdFromString = Schema.NumberFromString.annotations({
  title: "EntityIdFromString",
  description: "Entity identifier decoded from a path parameter string",
});
export type EntityIdFromString = typeof EntityIdFromString.Type;

export const Tags = Schema.Record({ key: Schema.String, value: Schema.String }).annotations({
  title: "Tags",
  description: "String key/value tag map for geospatial metadata",
});
export type Tags = typeof Tags.Type;

export const GeometryKind = Schema.Literal("line", "area").annotations({
  title: "GeometryKind",
  description: "Logical geometry type for a way",
});
export type GeometryKind = typeof GeometryKind.Type;

export class Point3D extends Schema.Class<Point3D>("Point3D")({
  x: Schema.Number.annotations({
    title: "x",
    description: "X coordinate",
  }),
  y: Schema.Number.annotations({
    title: "y",
    description: "Y coordinate",
  }),
  z: Schema.Number.annotations({
    title: "z",
    description: "Z coordinate",
  }),
}) {}

export class BBox2D extends Schema.Class<BBox2D>("BBox2D")({
  minX: Schema.Number.annotations({
    title: "minX",
    description: "Minimum X coordinate",
  }),
  minY: Schema.Number.annotations({
    title: "minY",
    description: "Minimum Y coordinate",
  }),
  maxX: Schema.Number.annotations({
    title: "maxX",
    description: "Maximum X coordinate",
  }),
  maxY: Schema.Number.annotations({
    title: "maxY",
    description: "Maximum Y coordinate",
  }),
}) {}
