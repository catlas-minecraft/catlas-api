use crate::modules::common::models::{
    ChangesetRow, INSERT_BATCH_SIZE, NewNode, NewNodeVersion, NewRelation, NewRelationMember,
    NewRelationMemberVersion, NewRelationVersion, NewWay, NewWayNode, NewWayNodeVersion,
    NewWayVersion,
};
use crate::modules::common::queries::lock_owned_changeset;
use crate::modules::common::validation::validate_publication_topology;
use crate::{
    database,
    schema::{core, derived, draft, history},
};
use diesel::{
    ExpressionMethods, JoinOnDsl, OptionalExtension, QueryDsl, RunQueryDsl, delete, insert_into,
    sql_query, update,
};
use serde_json::Value;

pub(super) fn check_node_version_conflicts(
    c: &mut database::DatabaseConnection,
    changeset_id: i64,
) -> Result<(), database::DatabaseError> {
    let rows = draft::nodes::table
        .filter(draft::nodes::changeset_id.eq(changeset_id))
        .filter(draft::nodes::operation.ne("create"))
        .select((draft::nodes::id, draft::nodes::base_version))
        .load::<(i64, Option<i32>)>(c)?;
    for (id, base) in rows {
        let current = core::nodes::table
            .filter(core::nodes::id.eq(id))
            .select(core::nodes::version)
            .first::<i32>(c)
            .optional()?;
        if current != base {
            return Err(std::io::Error::other("version conflict").into());
        }
    }
    Ok(())
}
pub(super) fn check_way_version_conflicts(
    c: &mut database::DatabaseConnection,
    changeset_id: i64,
) -> Result<(), database::DatabaseError> {
    let rows = draft::ways::table
        .filter(draft::ways::changeset_id.eq(changeset_id))
        .filter(draft::ways::operation.ne("create"))
        .select((draft::ways::id, draft::ways::base_version))
        .load::<(i64, Option<i32>)>(c)?;
    for (id, base) in rows {
        let current = core::ways::table
            .filter(core::ways::id.eq(id))
            .select(core::ways::version)
            .first::<i32>(c)
            .optional()?;
        if current != base {
            return Err(std::io::Error::other("version conflict").into());
        }
    }
    Ok(())
}
pub(super) fn check_relation_version_conflicts(
    c: &mut database::DatabaseConnection,
    changeset_id: i64,
) -> Result<(), database::DatabaseError> {
    let rows = draft::relations::table
        .filter(draft::relations::changeset_id.eq(changeset_id))
        .filter(draft::relations::operation.ne("create"))
        .select((draft::relations::id, draft::relations::base_version))
        .load::<(i64, Option<i32>)>(c)?;
    for (id, base) in rows {
        let current = core::relations::table
            .filter(core::relations::id.eq(id))
            .select(core::relations::version)
            .first::<i32>(c)
            .optional()?;
        if current != base {
            return Err(std::io::Error::other("version conflict").into());
        }
    }
    Ok(())
}
pub(super) fn check_node_id_conflicts(
    c: &mut database::DatabaseConnection,
    changeset_id: i64,
) -> Result<(), database::DatabaseError> {
    if draft::nodes::table
        .inner_join(core::nodes::table.on(core::nodes::id.eq(draft::nodes::id)))
        .filter(draft::nodes::changeset_id.eq(changeset_id))
        .filter(draft::nodes::operation.eq("create"))
        .select(core::nodes::id)
        .first::<i64>(c)
        .optional()?
        .is_some()
    {
        return Err(std::io::Error::other("id conflict").into());
    }
    Ok(())
}
pub(super) fn check_way_id_conflicts(
    c: &mut database::DatabaseConnection,
    changeset_id: i64,
) -> Result<(), database::DatabaseError> {
    if draft::ways::table
        .inner_join(core::ways::table.on(core::ways::id.eq(draft::ways::id)))
        .filter(draft::ways::changeset_id.eq(changeset_id))
        .filter(draft::ways::operation.eq("create"))
        .select(core::ways::id)
        .first::<i64>(c)
        .optional()?
        .is_some()
    {
        return Err(std::io::Error::other("id conflict").into());
    }
    Ok(())
}
pub(super) fn check_relation_id_conflicts(
    c: &mut database::DatabaseConnection,
    changeset_id: i64,
) -> Result<(), database::DatabaseError> {
    if draft::relations::table
        .inner_join(core::relations::table.on(core::relations::id.eq(draft::relations::id)))
        .filter(draft::relations::changeset_id.eq(changeset_id))
        .filter(draft::relations::operation.eq("create"))
        .select(core::relations::id)
        .first::<i64>(c)
        .optional()?
        .is_some()
    {
        return Err(std::io::Error::other("id conflict").into());
    }
    Ok(())
}

pub(crate) fn publish_sync(
    c: &mut database::DatabaseConnection,
    id: i64,
    user: &str,
) -> Result<ChangesetRow, database::DatabaseError> {
    sql_query("SELECT pg_advisory_xact_lock(hashtextextended('catlas.publish', 0))").execute(c)?;
    lock_owned_changeset(c, id, user)?;
    check_node_version_conflicts(c, id)?;
    check_way_version_conflicts(c, id)?;
    check_relation_version_conflicts(c, id)?;
    validate_publication_topology(c, id)?;
    check_node_id_conflicts(c, id)?;
    check_way_id_conflicts(c, id)?;
    check_relation_id_conflicts(c, id)?;
    // Parents are applied before child lists.  Every statement is part of the
    // caller's transaction, so a topology or constraint error rolls back all
    // publication work and leaves the draft untouched.
    let node_creates = draft::nodes::table
        .filter(draft::nodes::changeset_id.eq(id))
        .filter(draft::nodes::operation.eq("create"))
        .select((
            draft::nodes::id,
            draft::nodes::mc_x,
            draft::nodes::mc_y,
            draft::nodes::mc_z,
            draft::nodes::feature_type,
            draft::nodes::tags,
            draft::nodes::staged_by,
        ))
        .load::<(
            i64,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            Option<String>,
            Option<Value>,
            String,
        )>(c)?;
    let node_creates: Vec<_> = node_creates
        .into_iter()
        .map(|(node_id, x, y, z, feature_type, tags, by)| {
            Ok(NewNode {
                id: node_id,
                mc_x: x.ok_or_else(|| std::io::Error::other("invalid node draft"))?,
                mc_y: y.ok_or_else(|| std::io::Error::other("invalid node draft"))?,
                mc_z: z.ok_or_else(|| std::io::Error::other("invalid node draft"))?,
                feature_type: feature_type
                    .ok_or_else(|| std::io::Error::other("invalid node draft"))?,
                tags: tags.unwrap_or_else(|| serde_json::json!({})),
                created_changeset_id: id,
                created_by: by.clone(),
                updated_by: by,
                changeset_id: id,
            })
        })
        .collect::<Result<Vec<_>, std::io::Error>>()?;
    for chunk in node_creates.chunks(INSERT_BATCH_SIZE) {
        insert_into(core::nodes::table).values(chunk).execute(c)?;
    }
    let way_creates = draft::ways::table
        .filter(draft::ways::changeset_id.eq(id))
        .filter(draft::ways::operation.eq("create"))
        .select((
            draft::ways::id,
            draft::ways::feature_type,
            draft::ways::geometry_kind,
            draft::ways::is_closed,
            draft::ways::tags,
            draft::ways::staged_by,
        ))
        .load::<(
            i64,
            Option<String>,
            Option<String>,
            Option<bool>,
            Option<Value>,
            String,
        )>(c)?;
    let way_creates: Vec<_> = way_creates
        .into_iter()
        .map(
            |(way_id, feature_type, geometry_kind, is_closed, tags, by)| {
                Ok(NewWay {
                    id: way_id,
                    feature_type: feature_type
                        .ok_or_else(|| std::io::Error::other("invalid way draft"))?,
                    geometry_kind: geometry_kind
                        .ok_or_else(|| std::io::Error::other("invalid way draft"))?,
                    is_closed: is_closed.unwrap_or(false),
                    tags: tags.unwrap_or_else(|| serde_json::json!({})),
                    created_changeset_id: id,
                    created_by: by.clone(),
                    updated_by: by,
                    changeset_id: id,
                })
            },
        )
        .collect::<Result<Vec<_>, std::io::Error>>()?;
    for chunk in way_creates.chunks(INSERT_BATCH_SIZE) {
        insert_into(core::ways::table).values(chunk).execute(c)?;
    }
    let relation_creates = draft::relations::table
        .filter(draft::relations::changeset_id.eq(id))
        .filter(draft::relations::operation.eq("create"))
        .select((
            draft::relations::id,
            draft::relations::relation_type,
            draft::relations::tags,
            draft::relations::staged_by,
        ))
        .load::<(i64, Option<String>, Option<Value>, String)>(c)?;
    let relation_creates: Vec<_> = relation_creates
        .into_iter()
        .map(|(relation_id, relation_type, tags, by)| {
            Ok(NewRelation {
                id: relation_id,
                relation_type: relation_type
                    .ok_or_else(|| std::io::Error::other("invalid relation draft"))?,
                tags: tags.unwrap_or_else(|| serde_json::json!({})),
                created_changeset_id: id,
                created_by: by.clone(),
                updated_by: by,
                changeset_id: id,
            })
        })
        .collect::<Result<Vec<_>, std::io::Error>>()?;
    for chunk in relation_creates.chunks(INSERT_BATCH_SIZE) {
        insert_into(core::relations::table)
            .values(chunk)
            .execute(c)?;
    }

    let node_updates = draft::nodes::table
        .filter(draft::nodes::changeset_id.eq(id))
        .filter(draft::nodes::operation.eq("update"))
        .select((
            draft::nodes::id,
            draft::nodes::mc_x,
            draft::nodes::mc_y,
            draft::nodes::mc_z,
            draft::nodes::feature_type,
            draft::nodes::tags,
            draft::nodes::staged_by,
        ))
        .load::<(
            i64,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            Option<String>,
            Option<Value>,
            String,
        )>(c)?;
    for (node_id, x, y, z, feature_type, tags, by) in node_updates {
        update(core::nodes::table.filter(core::nodes::id.eq(node_id)))
            .set((
                core::nodes::mc_x.eq(x.ok_or_else(|| std::io::Error::other("invalid node draft"))?),
                core::nodes::mc_y.eq(y.ok_or_else(|| std::io::Error::other("invalid node draft"))?),
                core::nodes::mc_z.eq(z.ok_or_else(|| std::io::Error::other("invalid node draft"))?),
                core::nodes::feature_type
                    .eq(feature_type.ok_or_else(|| std::io::Error::other("invalid node draft"))?),
                core::nodes::tags.eq(tags.unwrap_or_else(|| serde_json::json!({}))),
                core::nodes::version.eq(core::nodes::version + 1),
                core::nodes::updated_at.eq(diesel::dsl::now),
                core::nodes::updated_by.eq(by),
                core::nodes::changeset_id.eq(id),
                core::nodes::deleted_at.eq(None::<chrono::DateTime<chrono::Utc>>),
            ))
            .execute(c)?;
    }
    let node_deletes = draft::nodes::table
        .filter(draft::nodes::changeset_id.eq(id))
        .filter(draft::nodes::operation.eq("delete"))
        .select((draft::nodes::id, draft::nodes::staged_by))
        .load::<(i64, String)>(c)?;
    for (node_id, by) in node_deletes {
        update(core::nodes::table.filter(core::nodes::id.eq(node_id)))
            .set((
                core::nodes::version.eq(core::nodes::version + 1),
                core::nodes::updated_at.eq(diesel::dsl::now),
                core::nodes::updated_by.eq(by),
                core::nodes::changeset_id.eq(id),
                core::nodes::deleted_at.eq(diesel::dsl::now),
            ))
            .execute(c)?;
    }
    let way_updates = draft::ways::table
        .filter(draft::ways::changeset_id.eq(id))
        .filter(draft::ways::operation.eq("update"))
        .select((
            draft::ways::id,
            draft::ways::feature_type,
            draft::ways::geometry_kind,
            draft::ways::is_closed,
            draft::ways::tags,
            draft::ways::staged_by,
        ))
        .load::<(
            i64,
            Option<String>,
            Option<String>,
            Option<bool>,
            Option<Value>,
            String,
        )>(c)?;
    for (way_id, feature_type, geometry_kind, is_closed, tags, by) in way_updates {
        update(core::ways::table.filter(core::ways::id.eq(way_id)))
            .set((
                core::ways::feature_type
                    .eq(feature_type.ok_or_else(|| std::io::Error::other("invalid way draft"))?),
                core::ways::geometry_kind
                    .eq(geometry_kind.ok_or_else(|| std::io::Error::other("invalid way draft"))?),
                core::ways::is_closed.eq(is_closed.unwrap_or(false)),
                core::ways::tags.eq(tags.unwrap_or_else(|| serde_json::json!({}))),
                core::ways::version.eq(core::ways::version + 1),
                core::ways::updated_at.eq(diesel::dsl::now),
                core::ways::updated_by.eq(by),
                core::ways::changeset_id.eq(id),
                core::ways::deleted_at.eq(None::<chrono::DateTime<chrono::Utc>>),
            ))
            .execute(c)?;
    }
    let way_deletes = draft::ways::table
        .filter(draft::ways::changeset_id.eq(id))
        .filter(draft::ways::operation.eq("delete"))
        .select((draft::ways::id, draft::ways::staged_by))
        .load::<(i64, String)>(c)?;
    for (way_id, by) in way_deletes {
        update(core::ways::table.filter(core::ways::id.eq(way_id)))
            .set((
                core::ways::version.eq(core::ways::version + 1),
                core::ways::updated_at.eq(diesel::dsl::now),
                core::ways::updated_by.eq(by),
                core::ways::changeset_id.eq(id),
                core::ways::deleted_at.eq(diesel::dsl::now),
            ))
            .execute(c)?;
    }
    let relation_updates = draft::relations::table
        .filter(draft::relations::changeset_id.eq(id))
        .filter(draft::relations::operation.eq("update"))
        .select((
            draft::relations::id,
            draft::relations::relation_type,
            draft::relations::tags,
            draft::relations::staged_by,
        ))
        .load::<(i64, Option<String>, Option<Value>, String)>(c)?;
    for (relation_id, relation_type, tags, by) in relation_updates {
        update(core::relations::table.filter(core::relations::id.eq(relation_id)))
            .set((
                core::relations::relation_type
                    .eq(relation_type
                        .ok_or_else(|| std::io::Error::other("invalid relation draft"))?),
                core::relations::tags.eq(tags.unwrap_or_else(|| serde_json::json!({}))),
                core::relations::version.eq(core::relations::version + 1),
                core::relations::updated_at.eq(diesel::dsl::now),
                core::relations::updated_by.eq(by),
                core::relations::changeset_id.eq(id),
                core::relations::deleted_at.eq(None::<chrono::DateTime<chrono::Utc>>),
            ))
            .execute(c)?;
    }
    let relation_deletes = draft::relations::table
        .filter(draft::relations::changeset_id.eq(id))
        .filter(draft::relations::operation.eq("delete"))
        .select((draft::relations::id, draft::relations::staged_by))
        .load::<(i64, String)>(c)?;
    for (relation_id, by) in relation_deletes {
        update(core::relations::table.filter(core::relations::id.eq(relation_id)))
            .set((
                core::relations::version.eq(core::relations::version + 1),
                core::relations::updated_at.eq(diesel::dsl::now),
                core::relations::updated_by.eq(by),
                core::relations::changeset_id.eq(id),
                core::relations::deleted_at.eq(diesel::dsl::now),
            ))
            .execute(c)?;
    }

    let deleted_way_ids: Vec<i64> = draft::ways::table
        .filter(draft::ways::changeset_id.eq(id))
        .filter(draft::ways::operation.eq("delete"))
        .select(draft::ways::id)
        .load(c)?;
    let deleted_relation_ids: Vec<i64> = draft::relations::table
        .filter(draft::relations::changeset_id.eq(id))
        .filter(draft::relations::operation.eq("delete"))
        .select(draft::relations::id)
        .load(c)?;
    let way_ids = draft::ways::table
        .filter(draft::ways::changeset_id.eq(id))
        .select(draft::ways::id)
        .load::<i64>(c)?;
    let relation_ids = draft::relations::table
        .filter(draft::relations::changeset_id.eq(id))
        .select(draft::relations::id)
        .load::<i64>(c)?;
    let old_wn = core::way_nodes::table
        .filter(core::way_nodes::way_id.eq_any(&deleted_way_ids))
        .select((
            core::way_nodes::way_id,
            core::way_nodes::seq,
            core::way_nodes::node_id,
            core::way_nodes::changeset_id,
        ))
        .load::<(i64, i32, i64, i64)>(c)?;
    let old_rn = core::relation_members::table
        .filter(core::relation_members::relation_id.eq_any(&deleted_relation_ids))
        .select((
            core::relation_members::relation_id,
            core::relation_members::seq,
            core::relation_members::member_type,
            core::relation_members::member_id,
            core::relation_members::role,
            core::relation_members::changeset_id,
        ))
        .load::<(i64, i32, String, i64, Option<String>, i64)>(c)?;
    let way_versions = core::ways::table
        .filter(core::ways::id.eq_any(&way_ids))
        .select((core::ways::id, core::ways::version))
        .load::<(i64, i32)>(c)?
        .into_iter()
        .collect::<std::collections::HashMap<_, _>>();
    let relation_versions = core::relations::table
        .filter(core::relations::id.eq_any(&relation_ids))
        .select((core::relations::id, core::relations::version))
        .load::<(i64, i32)>(c)?
        .into_iter()
        .collect::<std::collections::HashMap<_, _>>();
    let old_wn: Vec<_> = old_wn
        .into_iter()
        .map(|(way_id, seq, node_id, changeset_id)| {
            Ok(NewWayNodeVersion {
                way_id,
                parent_version: *way_versions
                    .get(&way_id)
                    .ok_or_else(|| std::io::Error::other("missing way version"))?,
                seq,
                snapshot: serde_json::json!({"wayId":way_id,"seq":seq,"nodeId":node_id,"changesetId":changeset_id}),
                changeset_id: id,
            })
        })
        .collect::<Result<Vec<_>, std::io::Error>>()?;
    for chunk in old_wn.chunks(INSERT_BATCH_SIZE) {
        insert_into(history::way_node_versions::table)
            .values(chunk)
            .execute(c)?;
    }
    let old_rn: Vec<_> = old_rn
        .into_iter()
        .map(|(relation_id, seq, member_type, member_id, role, changeset_id)| {
            Ok(NewRelationMemberVersion {
                relation_id,
                parent_version: *relation_versions
                    .get(&relation_id)
                    .ok_or_else(|| std::io::Error::other("missing relation version"))?,
                seq,
                snapshot: serde_json::json!({"relationId":relation_id,"seq":seq,"memberType":member_type,"memberId":member_id,"role":role,"changesetId":changeset_id}),
                changeset_id: id,
            })
        })
        .collect::<Result<Vec<_>, std::io::Error>>()?;
    for chunk in old_rn.chunks(INSERT_BATCH_SIZE) {
        insert_into(history::relation_member_versions::table)
            .values(chunk)
            .execute(c)?;
    }
    delete(core::way_nodes::table.filter(core::way_nodes::way_id.eq_any(&way_ids))).execute(c)?;
    let new_wn = draft::way_nodes::table
        .filter(draft::way_nodes::changeset_id.eq(id))
        .filter(draft::way_nodes::way_id.eq_any(&way_ids))
        .select((
            draft::way_nodes::way_id,
            draft::way_nodes::seq,
            draft::way_nodes::node_id,
            draft::way_nodes::changeset_id,
        ))
        .load::<(i64, i32, i64, i64)>(c)?;
    let live_wn = new_wn
        .into_iter()
        .filter(|(way_id, _, _, _)| !deleted_way_ids.contains(way_id))
        .map(|(way_id, seq, node_id, changeset_id)| NewWayNode {
            way_id,
            seq,
            node_id,
            changeset_id,
        })
        .collect::<Vec<_>>();
    for chunk in live_wn.chunks(INSERT_BATCH_SIZE) {
        insert_into(core::way_nodes::table)
            .values(chunk)
            .execute(c)?;
    }
    delete(
        core::relation_members::table
            .filter(core::relation_members::relation_id.eq_any(&relation_ids)),
    )
    .execute(c)?;
    let new_rm = draft::relation_members::table
        .filter(draft::relation_members::changeset_id.eq(id))
        .filter(draft::relation_members::relation_id.eq_any(&relation_ids))
        .select((
            draft::relation_members::relation_id,
            draft::relation_members::seq,
            draft::relation_members::member_type,
            draft::relation_members::member_id,
            draft::relation_members::role,
            draft::relation_members::changeset_id,
        ))
        .load::<(i64, i32, String, i64, Option<String>, i64)>(c)?;
    let live_rm = new_rm
        .into_iter()
        .filter(|(relation_id, _, _, _, _, _)| !deleted_relation_ids.contains(relation_id))
        .map(
            |(relation_id, seq, member_type, member_id, role, changeset_id)| NewRelationMember {
                relation_id,
                member_type,
                member_id,
                seq,
                role,
                changeset_id,
            },
        )
        .collect::<Vec<_>>();
    for chunk in live_rm.chunks(INSERT_BATCH_SIZE) {
        insert_into(core::relation_members::table)
            .values(chunk)
            .execute(c)?;
    }
    let nodes = core::nodes::table
        .filter(
            core::nodes::id.eq_any(
                draft::nodes::table
                    .filter(draft::nodes::changeset_id.eq(id))
                    .select(draft::nodes::id),
            ),
        )
        .select((
            core::nodes::id,
            core::nodes::version,
            core::nodes::deleted_at,
            core::nodes::mc_x,
            core::nodes::mc_y,
            core::nodes::mc_z,
            core::nodes::feature_type,
            core::nodes::tags,
            core::nodes::changeset_id,
            core::nodes::created_changeset_id,
            core::nodes::created_by,
            core::nodes::updated_by,
        ))
        .load::<(
            i64,
            i32,
            Option<chrono::DateTime<chrono::Utc>>,
            f64,
            f64,
            f64,
            String,
            Value,
            i64,
            i64,
            String,
            String,
        )>(c)?;
    let nodes: Vec<_> = nodes.into_iter().map(|(node_id,version,deleted_at,x,y,z,feature_type,tags,changeset_id,created_changeset_id,created_by,updated_by)| NewNodeVersion { node_id,version,snapshot: serde_json::json!({"id":node_id,"version":version,"deletedAt":deleted_at,"geom":{"x":x,"y":y,"z":z},"featureType":feature_type,"tags":tags,"changesetId":changeset_id,"createdChangesetId":created_changeset_id,"createdBy":created_by,"updatedBy":updated_by}),changeset_id:id }).collect();
    for chunk in nodes.chunks(INSERT_BATCH_SIZE) {
        insert_into(history::node_versions::table)
            .values(chunk)
            .execute(c)?;
    }
    let ways = core::ways::table
        .filter(core::ways::id.eq_any(&way_ids))
        .select((
            core::ways::id,
            core::ways::version,
            core::ways::deleted_at,
            core::ways::feature_type,
            core::ways::geometry_kind,
            core::ways::is_closed,
            core::ways::tags,
            core::ways::changeset_id,
            core::ways::created_changeset_id,
            core::ways::created_by,
            core::ways::updated_by,
        ))
        .load::<(
            i64,
            i32,
            Option<chrono::DateTime<chrono::Utc>>,
            String,
            String,
            bool,
            Value,
            i64,
            i64,
            String,
            String,
        )>(c)?;
    let ways: Vec<_> = ways.into_iter().map(|(way_id,version,deleted_at,feature_type,geometry_kind,is_closed,tags,changeset_id,created_changeset_id,created_by,updated_by)| NewWayVersion { way_id,version,snapshot: serde_json::json!({"id":way_id,"version":version,"deletedAt":deleted_at,"featureType":feature_type,"geometryKind":geometry_kind,"isClosed":is_closed,"tags":tags,"changesetId":changeset_id,"createdChangesetId":created_changeset_id,"createdBy":created_by,"updatedBy":updated_by}),changeset_id:id }).collect();
    for chunk in ways.chunks(INSERT_BATCH_SIZE) {
        insert_into(history::way_versions::table)
            .values(chunk)
            .execute(c)?;
    }
    let relations = core::relations::table
        .filter(core::relations::id.eq_any(&relation_ids))
        .select((
            core::relations::id,
            core::relations::version,
            core::relations::deleted_at,
            core::relations::relation_type,
            core::relations::tags,
            core::relations::changeset_id,
            core::relations::created_changeset_id,
            core::relations::created_by,
            core::relations::updated_by,
        ))
        .load::<(
            i64,
            i32,
            Option<chrono::DateTime<chrono::Utc>>,
            String,
            Value,
            i64,
            i64,
            String,
            String,
        )>(c)?;
    let relations: Vec<_> = relations.into_iter().map(|(relation_id,version,deleted_at,relation_type,tags,changeset_id,created_changeset_id,created_by,updated_by)| NewRelationVersion { relation_id,version,snapshot: serde_json::json!({"id":relation_id,"version":version,"deletedAt":deleted_at,"relationType":relation_type,"tags":tags,"changesetId":changeset_id,"createdChangesetId":created_changeset_id,"createdBy":created_by,"updatedBy":updated_by}),changeset_id:id }).collect();
    for chunk in relations.chunks(INSERT_BATCH_SIZE) {
        insert_into(history::relation_versions::table)
            .values(chunk)
            .execute(c)?;
    }
    let wn = core::way_nodes::table
        .filter(core::way_nodes::way_id.eq_any(&way_ids))
        .select((
            core::way_nodes::way_id,
            core::way_nodes::seq,
            core::way_nodes::node_id,
            core::way_nodes::changeset_id,
        ))
        .load::<(i64, i32, i64, i64)>(c)?;
    let wn: Vec<_> = wn.into_iter().map(|(way_id,seq,node_id,changeset_id)| Ok(NewWayNodeVersion { way_id,parent_version:*way_versions.get(&way_id).ok_or_else(|| std::io::Error::other("missing way version"))?,seq,snapshot:serde_json::json!({"wayId":way_id,"seq":seq,"nodeId":node_id,"changesetId":changeset_id}),changeset_id:id })).collect::<Result<Vec<_>, std::io::Error>>()?;
    for chunk in wn.chunks(INSERT_BATCH_SIZE) {
        insert_into(history::way_node_versions::table)
            .values(chunk)
            .execute(c)?;
    }
    let rm = core::relation_members::table
        .filter(core::relation_members::relation_id.eq_any(&relation_ids))
        .select((
            core::relation_members::relation_id,
            core::relation_members::seq,
            core::relation_members::member_type,
            core::relation_members::member_id,
            core::relation_members::role,
            core::relation_members::changeset_id,
        ))
        .load::<(i64, i32, String, i64, Option<String>, i64)>(c)?;
    let rm: Vec<_> = rm.into_iter().map(|(relation_id,seq,member_type,member_id,role,changeset_id)| Ok(NewRelationMemberVersion { relation_id,parent_version:*relation_versions.get(&relation_id).ok_or_else(|| std::io::Error::other("missing relation version"))?,seq,snapshot:serde_json::json!({"relationId":relation_id,"seq":seq,"memberType":member_type,"memberId":member_id,"role":role,"changesetId":changeset_id}),changeset_id:id })).collect::<Result<Vec<_>, std::io::Error>>()?;
    for chunk in rm.chunks(INSERT_BATCH_SIZE) {
        insert_into(history::relation_member_versions::table)
            .values(chunk)
            .execute(c)?;
    }
    delete(derived::way_geometries::table).execute(c)?;
    sql_query("WITH linework AS (SELECT w.id,w.geometry_kind,w.version,ST_MakeLine(ARRAY(SELECT ST_SetSRID(ST_MakePoint(n.mc_x,n.mc_z),0) FROM core.way_nodes wn JOIN core.nodes n ON n.id=wn.node_id WHERE wn.way_id=w.id AND n.deleted_at IS NULL ORDER BY wn.seq)) geom,(SELECT count(DISTINCT wn.node_id) FROM core.way_nodes wn WHERE wn.way_id=w.id) distinct_nodes FROM core.ways w WHERE w.deleted_at IS NULL) INSERT INTO derived.way_geometries(way_id,geom,bbox,source_version) SELECT id,CASE WHEN geometry_kind='area' THEN ST_MakePolygon(geom) ELSE geom END,ST_Envelope(CASE WHEN geometry_kind='area' THEN ST_MakePolygon(geom) ELSE geom END),version FROM linework WHERE geometry_kind='line' OR (distinct_nodes>=3 AND ST_IsClosed(geom) AND ST_IsValid(ST_MakePolygon(geom)))").execute(c)?;
    delete(derived::relation_geometries::table).execute(c)?;
    sql_query("WITH grouped AS (SELECT r.id,r.version,ST_Union(g.geom) FILTER (WHERE m.role IS NULL OR m.role='outer') outer_geom,ST_Union(g.geom) FILTER (WHERE m.role='inner') inner_geom FROM core.relations r JOIN core.relation_members m ON m.relation_id=r.id AND m.member_type='way' JOIN core.ways w ON w.id=m.member_id AND w.geometry_kind='area' AND w.deleted_at IS NULL JOIN derived.way_geometries g ON g.way_id=m.member_id WHERE r.deleted_at IS NULL AND r.relation_type='multipolygon' AND NOT EXISTS (SELECT 1 FROM core.relation_members bad WHERE bad.relation_id=r.id AND (bad.member_type<>'way' OR bad.role IS NOT NULL AND bad.role NOT IN ('outer','inner'))) GROUP BY r.id,r.version) INSERT INTO derived.relation_geometries(relation_id,geom,bbox,source_version) SELECT id,ST_Multi(ST_CollectionExtract(CASE WHEN inner_geom IS NULL THEN outer_geom ELSE ST_Difference(outer_geom,inner_geom) END,3)),ST_Envelope(CASE WHEN inner_geom IS NULL THEN outer_geom ELSE ST_Difference(outer_geom,inner_geom) END),version FROM grouped WHERE outer_geom IS NOT NULL AND NOT ST_IsEmpty(outer_geom) AND ST_IsValid(CASE WHEN inner_geom IS NULL THEN outer_geom ELSE ST_Difference(outer_geom,inner_geom) END)").execute(c)?;
    delete(draft::nodes::table.filter(draft::nodes::changeset_id.eq(id))).execute(c)?;
    delete(draft::ways::table.filter(draft::ways::changeset_id.eq(id))).execute(c)?;
    delete(draft::relations::table.filter(draft::relations::changeset_id.eq(id))).execute(c)?;
    let row = update(core::changesets::table.filter(core::changesets::id.eq(id)))
        .set((
            core::changesets::status.eq("published"),
            core::changesets::published_at.eq(diesel::dsl::now),
        ))
        .returning((
            core::changesets::id,
            core::changesets::status,
            core::changesets::comment,
            core::changesets::created_by,
            core::changesets::created_at,
            core::changesets::published_at,
        ))
        .get_result::<(
            i64,
            String,
            Option<String>,
            String,
            chrono::DateTime<chrono::Utc>,
            Option<chrono::DateTime<chrono::Utc>>,
        )>(c)?;
    Ok(ChangesetRow {
        id: row.0,
        status: row.1,
        comment: row.2,
        created_by: row.3,
        created_at: row.4,
        published_at: row.5,
    })
}
