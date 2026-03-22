ALTER TABLE derived.way_geometries
  ALTER COLUMN geom TYPE geometry;

ALTER TABLE derived.relation_geometries
  ALTER COLUMN geom TYPE geometry;
