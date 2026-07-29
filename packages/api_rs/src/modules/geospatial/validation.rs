use super::types::{Point, RelationMember};
use crate::{
    database,
    schema::{core, draft},
};
use diesel::{ExpressionMethods, QueryDsl, RunQueryDsl};
use poem::Result;
use postgis_diesel::types::{LineString, Point as PostgisPoint};
use serde_json::Value;
use std::{collections::HashSet, error::Error, fmt};

type EffectiveMember = (i32, String, i64, Option<String>);

diesel::define_sql_function! {
    #[sql_name = "ST_IsClosed"]
    fn st_is_closed_sql(geometry: postgis_diesel::sql_types::Geometry) -> diesel::sql_types::Bool;
}
diesel::define_sql_function! {
    #[sql_name = "ST_MakePolygon"]
    fn st_make_polygon_sql(geometry: postgis_diesel::sql_types::Geometry) -> postgis_diesel::sql_types::Geometry;
}
diesel::define_sql_function! {
    #[sql_name = "ST_IsValid"]
    fn st_is_valid_sql(geometry: postgis_diesel::sql_types::Geometry) -> diesel::sql_types::Bool;
}

pub(super) use self::st_is_closed_sql as st_is_closed;
pub(super) use self::st_is_valid_sql as st_is_valid;

/// Validate the final graph before changing any core row. Draft deletes must
/// win over core rows in every effective-state predicate.
pub(super) use self::st_make_polygon_sql as st_make_polygon;

pub(super) fn tag_value(value: &std::collections::BTreeMap<String, String>) -> Result<Value> {
    serde_json::to_value(value)
        .map_err(|_| poem::Error::from_status(poem::http::StatusCode::BAD_REQUEST))
}
pub(super) fn validate_tags(value: &std::collections::BTreeMap<String, String>) -> Result<()> {
    if value.keys().any(|key| {
        matches!(
            key.as_str(),
            "feature_type"
                | "relation_type"
                | "geometry_kind"
                | "is_closed"
                | "version"
                | "deleted_at"
                | "changeset_id"
        )
    }) {
        return Err(poem::Error::from_status(
            poem::http::StatusCode::BAD_REQUEST,
        ));
    }
    Ok(())
}
pub(super) fn validate_point(p: &Point) -> Result<()> {
    if [p.x, p.y, p.z].iter().any(|v| !v.is_finite()) {
        Err(poem::Error::from_status(
            poem::http::StatusCode::UNPROCESSABLE_ENTITY,
        ))
    } else {
        Ok(())
    }
}
pub(super) fn validate_way(kind: &str, refs: &[i64]) -> Result<()> {
    let valid = match kind {
        "line" => {
            refs.len() >= 2 && refs.iter().collect::<std::collections::BTreeSet<_>>().len() >= 2
        }
        "area" => {
            refs.len() >= 4
                && refs.first() == refs.last()
                && refs[..refs.len() - 1]
                    .iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .len()
                    >= 3
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(poem::Error::from_status(
            poem::http::StatusCode::UNPROCESSABLE_ENTITY,
        ))
    }
}
pub(super) fn validate_members(members: &[RelationMember]) -> Result<()> {
    let mut seen = std::collections::BTreeSet::new();
    if !members.is_empty()
        && members.iter().all(|member| {
            member.member_type == "way"
                && matches!(member.role.as_deref(), None | Some("outer") | Some("inner"))
                && seen.insert((member.member_type.as_str(), member.member_id))
        })
        && members
            .iter()
            .any(|member| matches!(member.role.as_deref(), None | Some("outer")))
    {
        Ok(())
    } else {
        Err(poem::Error::from_status(
            poem::http::StatusCode::BAD_REQUEST,
        ))
    }
}
#[derive(Debug)]
pub(super) struct DomainFailure(pub(super) &'static str);
impl fmt::Display for DomainFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}
impl Error for DomainFailure {}

pub(super) fn validate_publication_topology(
    c: &mut database::DatabaseConnection,
    id: i64,
) -> Result<(), database::DatabaseError> {
    let draft_nodes = draft::nodes::table
        .filter(draft::nodes::changeset_id.eq(id))
        .select((
            draft::nodes::id,
            draft::nodes::operation,
            draft::nodes::mc_x,
            draft::nodes::mc_z,
        ))
        .load::<(i64, String, Option<f64>, Option<f64>)>(c)?;
    let draft_node_ids: HashSet<i64> = draft_nodes.iter().map(|row| row.0).collect();
    let deleted_nodes: HashSet<i64> = draft_nodes
        .iter()
        .filter(|row| row.1 == "delete")
        .map(|row| row.0)
        .collect();
    let core_nodes = core::nodes::table
        .filter(core::nodes::deleted_at.is_null())
        .select((core::nodes::id, core::nodes::mc_x, core::nodes::mc_z))
        .load::<(i64, f64, f64)>(c)?;
    let mut node_points: std::collections::HashMap<i64, PostgisPoint> = core_nodes
        .into_iter()
        .filter(|row| !draft_node_ids.contains(&row.0))
        .map(|(node_id, x, z)| (node_id, PostgisPoint::new(x, z, Some(0))))
        .collect();
    for (node_id, operation, x, z) in &draft_nodes {
        if operation != "delete"
            && let (Some(x), Some(z)) = (x, z)
        {
            node_points.insert(*node_id, PostgisPoint::new(*x, *z, Some(0)));
        }
    }
    let effective_node_ids: HashSet<i64> = node_points.keys().copied().collect();

    let core_ways = core::ways::table
        .filter(core::ways::deleted_at.is_null())
        .select((core::ways::id, core::ways::geometry_kind))
        .load::<(i64, String)>(c)?;
    let draft_ways = draft::ways::table
        .filter(draft::ways::changeset_id.eq(id))
        .select((
            draft::ways::id,
            draft::ways::operation,
            draft::ways::geometry_kind,
        ))
        .load::<(i64, String, Option<String>)>(c)?;
    let shadowed_ways: HashSet<i64> = draft_ways.iter().map(|row| row.0).collect();
    let mut effective_ways: std::collections::HashMap<i64, String> = core_ways
        .into_iter()
        .filter(|row| !shadowed_ways.contains(&row.0))
        .collect();
    let active_draft_ways: HashSet<i64> = draft_ways
        .iter()
        .filter(|row| row.1 != "delete")
        .map(|row| row.0)
        .collect();
    for (way_id, operation, kind) in &draft_ways {
        if operation != "delete"
            && let Some(kind) = kind
        {
            effective_ways.insert(*way_id, kind.clone());
        }
    }
    let core_way_nodes = core::way_nodes::table
        .select((
            core::way_nodes::way_id,
            core::way_nodes::seq,
            core::way_nodes::node_id,
        ))
        .load::<(i64, i32, i64)>(c)?;
    let draft_way_nodes = draft::way_nodes::table
        .filter(draft::way_nodes::changeset_id.eq(id))
        .select((
            draft::way_nodes::way_id,
            draft::way_nodes::seq,
            draft::way_nodes::node_id,
        ))
        .load::<(i64, i32, i64)>(c)?;
    let mut way_nodes: std::collections::HashMap<i64, Vec<(i32, i64)>> =
        std::collections::HashMap::new();
    for (way_id, seq, node_id) in core_way_nodes {
        if !shadowed_ways.contains(&way_id) {
            way_nodes.entry(way_id).or_default().push((seq, node_id));
        }
    }
    for (way_id, seq, node_id) in draft_way_nodes {
        if active_draft_ways.contains(&way_id) {
            way_nodes.entry(way_id).or_default().push((seq, node_id));
        }
    }
    for nodes in way_nodes.values_mut() {
        nodes.sort_by_key(|row| row.0);
    }

    if active_draft_ways.iter().any(|way_id| {
        way_nodes
            .get(way_id)
            .into_iter()
            .flatten()
            .any(|(_, node_id)| !effective_node_ids.contains(node_id))
    }) {
        return Err(Box::new(DomainFailure("invalid reference")));
    }
    if way_nodes
        .values()
        .flatten()
        .any(|(_, node_id)| deleted_nodes.contains(node_id))
    {
        return Err(Box::new(DomainFailure("invalid topology")));
    }

    let core_relations = core::relations::table
        .filter(core::relations::deleted_at.is_null())
        .select(core::relations::id)
        .load::<i64>(c)?;
    let draft_relations = draft::relations::table
        .filter(draft::relations::changeset_id.eq(id))
        .select((
            draft::relations::id,
            draft::relations::operation,
            draft::relations::relation_type,
        ))
        .load::<(i64, String, Option<String>)>(c)?;
    let shadowed_relations: HashSet<i64> = draft_relations.iter().map(|row| row.0).collect();
    let mut effective_relations: HashSet<i64> = core_relations
        .into_iter()
        .filter(|relation_id| !shadowed_relations.contains(relation_id))
        .collect();
    let active_draft_relations: HashSet<i64> = draft_relations
        .iter()
        .filter(|row| row.1 != "delete")
        .map(|row| row.0)
        .collect();
    effective_relations.extend(active_draft_relations.iter().copied());
    let core_members = core::relation_members::table
        .select((
            core::relation_members::relation_id,
            core::relation_members::seq,
            core::relation_members::member_type,
            core::relation_members::member_id,
            core::relation_members::role,
        ))
        .load::<(i64, i32, String, i64, Option<String>)>(c)?;
    let draft_members = draft::relation_members::table
        .filter(draft::relation_members::changeset_id.eq(id))
        .select((
            draft::relation_members::relation_id,
            draft::relation_members::seq,
            draft::relation_members::member_type,
            draft::relation_members::member_id,
            draft::relation_members::role,
        ))
        .load::<(i64, i32, String, i64, Option<String>)>(c)?;
    let mut relation_members: std::collections::HashMap<i64, Vec<EffectiveMember>> =
        std::collections::HashMap::new();
    for (relation_id, seq, member_type, member_id, role) in core_members {
        if effective_relations.contains(&relation_id) && !shadowed_relations.contains(&relation_id)
        {
            relation_members.entry(relation_id).or_default().push((
                seq,
                member_type,
                member_id,
                role,
            ));
        }
    }
    for (relation_id, seq, member_type, member_id, role) in draft_members {
        if active_draft_relations.contains(&relation_id) {
            relation_members.entry(relation_id).or_default().push((
                seq,
                member_type,
                member_id,
                role,
            ));
        }
    }
    for members in relation_members.values_mut() {
        members.sort_by_key(|row| row.0);
    }
    let effective_way_ids: HashSet<i64> = effective_ways.keys().copied().collect();
    for relation_id in &active_draft_relations {
        let members = relation_members
            .get(relation_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        if members.iter().any(
            |(_, member_type, member_id, _)| match member_type.as_str() {
                "node" => !effective_node_ids.contains(member_id),
                "way" => !effective_way_ids.contains(member_id),
                "relation" => !effective_relations.contains(member_id),
                _ => true,
            },
        ) {
            return Err(Box::new(DomainFailure("invalid reference")));
        }
        let mut seen = HashSet::new();
        if members.iter().any(|(_, member_type, member_id, _)| {
            (member_type == "relation" && *member_id == *relation_id)
                || !seen.insert((member_type.as_str(), *member_id))
        }) {
            return Err(Box::new(DomainFailure("invalid topology")));
        }
    }
    if relation_members
        .values()
        .flatten()
        .any(|(_, member_type, member_id, _)| {
            (member_type == "node" && deleted_nodes.contains(member_id))
                || (member_type == "way"
                    && draft_ways
                        .iter()
                        .any(|row| row.0 == *member_id && row.1 == "delete"))
                || (member_type == "relation"
                    && draft_relations
                        .iter()
                        .any(|row| row.0 == *member_id && row.1 == "delete"))
        })
    {
        return Err(Box::new(DomainFailure("invalid topology")));
    }
    for (way_id, _, _) in draft_ways
        .iter()
        .filter(|row| row.1 != "delete" && row.2.as_deref() == Some("area"))
    {
        let nodes = way_nodes.get(way_id).map(Vec::as_slice).unwrap_or(&[]);
        if nodes
            .iter()
            .map(|(_, node_id)| node_id)
            .collect::<HashSet<_>>()
            .len()
            < 3
        {
            return Err(Box::new(DomainFailure("invalid geometry state")));
        }
        let line = LineString {
            points: nodes
                .iter()
                .filter_map(|(_, node_id)| node_points.get(node_id).copied())
                .collect(),
            srid: Some(0),
        };
        if !diesel::select(st_is_closed(line.clone())).get_result::<bool>(c)? {
            return Err(Box::new(DomainFailure("invalid geometry state")));
        }
        let polygon = st_make_polygon(line);
        if !diesel::select(st_is_valid(polygon)).get_result::<bool>(c)? {
            return Err(Box::new(DomainFailure("invalid geometry state")));
        }
    }
    for (relation_id, _, relation_type) in draft_relations.iter().filter(|row| row.1 != "delete") {
        let members = relation_members
            .get(relation_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        if relation_type.as_deref() != Some("multipolygon")
            || members.is_empty()
            || members.iter().any(|(_, member_type, member_id, role)| {
                member_type != "way"
                    || !matches!(role.as_deref(), None | Some("outer") | Some("inner"))
                    || effective_ways.get(member_id).map(String::as_str) != Some("area")
            })
            || !members
                .iter()
                .any(|(_, _, _, role)| matches!(role.as_deref(), None | Some("outer")))
        {
            return Err(Box::new(DomainFailure("invalid topology")));
        }
    }
    Ok(())
}
