import { sql } from "kysely"
import type { GeometryKind, GeometryValue } from "./Database.js"

export interface Point3DInput {
  x: number
  y: number
  z: number
}

export interface BBox2DInput {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const makePointZ = ({ x, y, z }: Point3DInput) =>
  sql<GeometryValue>`ST_SetSRID(ST_MakePoint(${x}, ${y}, ${z}), 0)`

export const selectPointZJson = (column: string) =>
  sql<Point3DInput>`json_build_object(
    'x', ST_X(${sql.ref(column)}),
    'y', ST_Y(${sql.ref(column)}),
    'z', COALESCE(ST_Z(${sql.ref(column)}), 0)
  )`

export const intersectsBBox2D = (column: string, bbox: BBox2DInput) =>
  sql<boolean>`ST_Intersects(
    ST_Force2D(${sql.ref(column)}),
    ST_MakeEnvelope(${bbox.minX}, ${bbox.minY}, ${bbox.maxX}, ${bbox.maxY}, 0)
  )`

const makeWayLineGeometry = (wayId: number) =>
  sql<GeometryValue>`(
    SELECT ST_MakeLine(node_geom ORDER BY seq)
    FROM (
      SELECT way_nodes.seq, nodes.geom AS node_geom
      FROM core.way_nodes
      INNER JOIN core.nodes ON nodes.id = way_nodes.node_id
      WHERE way_nodes.way_id = ${wayId}
        AND nodes.deleted_at IS NULL
    ) AS ordered_nodes
  )`

export const makeWayGeometry = (wayId: number, geometryKind: GeometryKind) =>
  geometryKind === "area"
    ? sql<GeometryValue>`(
        SELECT ST_MakePolygon(line_geom)
        FROM (
          SELECT ST_MakeLine(node_geom ORDER BY seq) AS line_geom
          FROM (
            SELECT way_nodes.seq, nodes.geom AS node_geom
            FROM core.way_nodes
            INNER JOIN core.nodes ON nodes.id = way_nodes.node_id
            WHERE way_nodes.way_id = ${wayId}
              AND nodes.deleted_at IS NULL
          ) AS ordered_nodes
        ) AS line_source
      )`
    : makeWayLineGeometry(wayId)

export const makeMultipolygonRelationGeometry = (relationId: number) =>
  sql<GeometryValue>`(
    WITH outer_geom AS (
      SELECT ST_UnaryUnion(ST_Collect(way_geometries.geom)) AS geom
      FROM core.relation_members
      INNER JOIN derived.way_geometries ON way_geometries.way_id = relation_members.member_id
      WHERE relation_members.relation_id = ${relationId}
        AND relation_members.member_type = 'way'
        AND (relation_members.role IS NULL OR relation_members.role = 'outer')
    ),
    inner_geom AS (
      SELECT ST_UnaryUnion(ST_Collect(way_geometries.geom)) AS geom
      FROM core.relation_members
      INNER JOIN derived.way_geometries ON way_geometries.way_id = relation_members.member_id
      WHERE relation_members.relation_id = ${relationId}
        AND relation_members.member_type = 'way'
        AND relation_members.role = 'inner'
    )
    SELECT CASE
      WHEN (SELECT geom FROM outer_geom) IS NULL THEN NULL
      WHEN (SELECT geom FROM inner_geom) IS NULL THEN (SELECT geom FROM outer_geom)
      ELSE ST_Difference((SELECT geom FROM outer_geom), (SELECT geom FROM inner_geom))
    END
  )`

export const makeGeometryBBox = (geometry: ReturnType<typeof sql<GeometryValue>>) =>
  sql<GeometryValue>`ST_Force2D(ST_Envelope(ST_Force2D(${geometry})))`
