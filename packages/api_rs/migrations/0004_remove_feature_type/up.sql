ALTER TABLE core.nodes DROP COLUMN feature_type;
ALTER TABLE core.ways DROP COLUMN feature_type;

ALTER TABLE draft.nodes DROP CONSTRAINT draft_nodes_fields;
ALTER TABLE draft.nodes DROP COLUMN feature_type;
ALTER TABLE draft.nodes ADD CONSTRAINT draft_nodes_fields CHECK (
  operation = 'delete'
  OR (
    mc_x IS NOT NULL AND mc_y IS NOT NULL AND mc_z IS NOT NULL
    AND tags IS NOT NULL
    AND core.catlas_are_string_tags(tags)
    AND core.catlas_has_no_reserved_tag_keys(tags)
  )
);

ALTER TABLE draft.ways DROP CONSTRAINT draft_ways_fields;
ALTER TABLE draft.ways DROP COLUMN feature_type;
ALTER TABLE draft.ways ADD CONSTRAINT draft_ways_fields CHECK (
  operation = 'delete'
  OR (
    geometry_kind IN ('line', 'area')
    AND is_closed IS NOT NULL AND tags IS NOT NULL
    AND core.catlas_are_string_tags(tags)
    AND core.catlas_has_no_reserved_tag_keys(tags)
  )
);

UPDATE history.node_versions
SET snapshot = snapshot - 'featureType'
WHERE snapshot ? 'featureType';
UPDATE history.way_versions
SET snapshot = snapshot - 'featureType'
WHERE snapshot ? 'featureType';

CREATE OR REPLACE FUNCTION core.catlas_has_no_reserved_tag_keys(input jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(input) AS key_name
    WHERE key_name = ANY (ARRAY[
      'relation_type', 'geometry_kind', 'is_closed',
      'version', 'deleted_at', 'changeset_id'
    ])
  );
$$;
