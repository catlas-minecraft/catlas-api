use crate::modules::common::types::{
    GeometryKind, Viewport, ViewportNode, ViewportRelation, ViewportRelationMember, ViewportWay,
    ViewportWayNode,
};
use crate::{
    database,
    schema::{core, derived},
};
use diesel::{ExpressionMethods, QueryDsl, RunQueryDsl};
use postgis_diesel::types::{Point as PostgisPoint, Polygon};
use postgis_diesel::{functions::st_intersects, functions_nullable, operators::intersects_2d};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

fn string_tags(value: Value) -> Result<BTreeMap<String, String>, database::DatabaseError> {
    Ok(serde_json::from_value(value)?)
}

fn parse_geometry_kind(value: String) -> Result<GeometryKind, database::DatabaseError> {
    match value.as_str() {
        "line" => Ok(GeometryKind::Line),
        "area" => Ok(GeometryKind::Area),
        value => Err(std::io::Error::other(format!(
            "invalid geometry kind from database: {value}"
        ))
        .into()),
    }
}

pub(crate) fn viewport_typed(
    c: &mut database::DatabaseConnection,
    bbox: [f64; 4],
    include_relations: bool,
) -> Result<Viewport, database::DatabaseError> {
    let envelope = bbox_geometry(bbox);
    let way_ids: Vec<i64> = derived::way_geometries::table
        .filter(intersects_2d(
            derived::way_geometries::bbox,
            envelope.clone(),
        ))
        .filter(st_intersects(
            derived::way_geometries::bbox,
            envelope.clone(),
        ))
        .select(derived::way_geometries::way_id)
        .order_by(derived::way_geometries::way_id)
        .load(c)?;
    let relation_ids: Vec<i64> = if include_relations {
        derived::relation_geometries::table
            .filter(intersects_2d(
                derived::relation_geometries::bbox,
                envelope.clone(),
            ))
            .filter(st_intersects(
                derived::relation_geometries::bbox,
                envelope.clone(),
            ))
            .select(derived::relation_geometries::relation_id)
            .order_by(derived::relation_geometries::relation_id)
            .load(c)?
    } else {
        vec![]
    };
    let ways = core::ways::table
        .filter(core::ways::id.eq_any(&way_ids))
        .filter(core::ways::deleted_at.is_null())
        .select((
            core::ways::id,
            core::ways::version,
            core::ways::feature_type,
            core::ways::geometry_kind,
            core::ways::tags,
            core::ways::is_closed,
            core::ways::deleted_at,
            core::ways::changeset_id,
        ))
        .order_by(core::ways::id)
        .load::<(
            i64,
            i32,
            String,
            String,
            Value,
            bool,
            Option<chrono::DateTime<chrono::Utc>>,
            i64,
        )>(c)?;
    let way_nodes = core::way_nodes::table
        .filter(core::way_nodes::way_id.eq_any(&way_ids))
        .select((
            core::way_nodes::way_id,
            core::way_nodes::seq,
            core::way_nodes::node_id,
            core::way_nodes::changeset_id,
        ))
        .order_by((core::way_nodes::way_id, core::way_nodes::seq))
        .load::<(i64, i32, i64, i64)>(c)?;
    let referenced: HashSet<i64> = way_nodes.iter().map(|row| row.2).collect();
    let spatial_nodes: Vec<i64> = core::nodes::table
        .filter(core::nodes::deleted_at.is_null())
        .filter(intersects_2d(core::nodes::geom_2d, envelope.clone()))
        .filter(
            functions_nullable::st_intersects(core::nodes::geom_2d, envelope.clone())
                .eq(Some(true)),
        )
        .select(core::nodes::id)
        .load(c)?;
    let mut node_ids: HashSet<i64> = referenced;
    node_ids.extend(spatial_nodes);
    let nodes = core::nodes::table
        .filter(core::nodes::id.eq_any(&node_ids))
        .filter(core::nodes::deleted_at.is_null())
        .select((
            core::nodes::id,
            core::nodes::version,
            core::nodes::mc_x,
            core::nodes::mc_y,
            core::nodes::mc_z,
            core::nodes::feature_type,
            core::nodes::tags,
            core::nodes::deleted_at,
            core::nodes::changeset_id,
        ))
        .order_by(core::nodes::id)
        .load::<(
            i64,
            i32,
            f64,
            f64,
            f64,
            String,
            Value,
            Option<chrono::DateTime<chrono::Utc>>,
            i64,
        )>(c)?;
    let relations = core::relations::table
        .filter(core::relations::id.eq_any(&relation_ids))
        .filter(core::relations::deleted_at.is_null())
        .select((
            core::relations::id,
            core::relations::version,
            core::relations::relation_type,
            core::relations::tags,
            core::relations::deleted_at,
            core::relations::changeset_id,
        ))
        .order_by(core::relations::id)
        .load::<(
            i64,
            i32,
            String,
            Value,
            Option<chrono::DateTime<chrono::Utc>>,
            i64,
        )>(c)?;
    let relation_members = core::relation_members::table
        .filter(core::relation_members::relation_id.eq_any(&relation_ids))
        .select((
            core::relation_members::relation_id,
            core::relation_members::seq,
            core::relation_members::member_type,
            core::relation_members::member_id,
            core::relation_members::role,
            core::relation_members::changeset_id,
        ))
        .order_by((
            core::relation_members::relation_id,
            core::relation_members::seq,
        ))
        .load::<(i64, i32, String, i64, Option<String>, i64)>(c)?;
    Ok(Viewport {
        nodes: nodes
            .into_iter()
            .map(
                |(id, version, x, y, z, feature_type, value, deleted_at, changeset_id)| {
                    Ok(ViewportNode {
                        id,
                        version,
                        geom: crate::modules::common::types::Point { x, y, z },
                        feature_type,
                        tags: string_tags(value)?,
                        deleted_at: deleted_at.into(),
                        changeset_id,
                    })
                },
            )
            .collect::<Result<Vec<_>, database::DatabaseError>>()?,
        ways: ways
            .into_iter()
            .map(
                |(
                    id,
                    version,
                    feature_type,
                    geometry_kind,
                    value,
                    is_closed,
                    deleted_at,
                    changeset_id,
                )| {
                    Ok(ViewportWay {
                        id,
                        version,
                        feature_type,
                        geometry_kind: parse_geometry_kind(geometry_kind)?,
                        tags: string_tags(value)?,
                        is_closed,
                        deleted_at: deleted_at.into(),
                        changeset_id,
                    })
                },
            )
            .collect::<Result<Vec<_>, database::DatabaseError>>()?,
        way_nodes: way_nodes
            .into_iter()
            .map(|(way_id, seq, node_id, changeset_id)| ViewportWayNode {
                way_id,
                seq,
                node_id,
                changeset_id,
            })
            .collect(),
        relations: relations
            .into_iter()
            .map(
                |(id, version, relation_type, value, deleted_at, changeset_id)| {
                    Ok(ViewportRelation {
                        id,
                        version,
                        relation_type,
                        tags: string_tags(value)?,
                        deleted_at: deleted_at.into(),
                        changeset_id,
                    })
                },
            )
            .collect::<Result<Vec<_>, database::DatabaseError>>()?,
        relation_members: relation_members
            .into_iter()
            .map(
                |(relation_id, seq, member_type, member_id, role, changeset_id)| {
                    ViewportRelationMember {
                        relation_id,
                        seq,
                        member_type,
                        member_id,
                        role: role.into(),
                        changeset_id,
                    }
                },
            )
            .collect(),
    })
}

pub(crate) fn parse_bbox(value: &str) -> Option<[f64; 4]> {
    let values: Vec<f64> = value
        .split(',')
        .map(str::parse::<f64>)
        .collect::<std::result::Result<_, _>>()
        .ok()?;
    if values.len() != 4
        || values.iter().any(|v| !v.is_finite())
        || values[0] > values[2]
        || values[1] > values[3]
    {
        return None;
    }
    Some([values[0], values[1], values[2], values[3]])
}

/// Build the PostGIS ground-plane envelope used by spatial predicates.  API
/// coordinates are X/Y/Z, while the stored SRID-0 geometry is X/Z.
pub(crate) fn bbox_geometry([min_x, min_z, max_x, max_z]: [f64; 4]) -> Polygon<PostgisPoint> {
    Polygon {
        rings: vec![vec![
            PostgisPoint::new(min_x, min_z, Some(0)),
            PostgisPoint::new(max_x, min_z, Some(0)),
            PostgisPoint::new(max_x, max_z, Some(0)),
            PostgisPoint::new(min_x, max_z, Some(0)),
            PostgisPoint::new(min_x, min_z, Some(0)),
        ]],
        srid: Some(0),
    }
}
