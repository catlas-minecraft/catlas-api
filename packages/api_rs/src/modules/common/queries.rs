use super::models::{
    DbJson, EntityState, INSERT_BATCH_SIZE, IdRow, NewDraftMember, NewDraftNode, NewDraftRelation,
    NewDraftWay, NewDraftWayNode,
};
use super::types::{
    DeleteInput, NodeInput, NodePatch, RelationInput, RelationMember, RelationPatch, WayInput,
    WayPatch,
};
use crate::{
    database,
    schema::{core, draft},
};
use diesel::{ExpressionMethods, OptionalExtension, QueryDsl, RunQueryDsl, delete, insert_into};
use serde_json::Value;
use std::collections::HashSet;

pub(crate) fn node_json(row: (i64, i32, f64, f64, f64, DbJson)) -> Value {
    let (id, version, x, y, z, tags) = row;
    serde_json::json!({"id": id, "version": version, "geom": {"x": x, "y": y, "z": z}, "tags": tags})
}

pub(crate) fn create_node_typed(
    c: &mut database::DatabaseConnection,
    input: NodeInput,
    tags: DbJson,
    user: i64,
) -> Result<IdRow, database::DatabaseError> {
    let id = diesel::select(diesel::dsl::sql::<diesel::sql_types::BigInt>(
        "nextval('core.node_id_seq'::regclass)",
    ))
    .get_result::<i64>(c)?;
    insert_into(draft::nodes::table)
        .values(NewDraftNode {
            changeset_id: input.changeset_id,
            id,
            operation: "create",
            base_version: None,
            mc_x: Some(input.geom.x),
            mc_y: Some(input.geom.y),
            mc_z: Some(input.geom.z),
            tags: Some(tags),
            staged_by_user_id: user,
        })
        .execute(c)?;
    Ok(IdRow { id, version: 1 })
}

pub(crate) fn patch_node_typed(
    c: &mut database::DatabaseConnection,
    node_id: i64,
    input: NodePatch,
    tags: DbJson,
    user: i64,
) -> Result<IdRow, database::DatabaseError> {
    let state = node_state(c, input.changeset_id, node_id)?;
    let required_version = expected_version(&state)?;
    if input.expected_version != required_version {
        return Err(std::io::Error::other("version conflict").into());
    }
    let proposed_version = if state.operation == "create" {
        1
    } else {
        state
            .base_version
            .or(state.current_version)
            .ok_or_else(|| std::io::Error::other("node not found"))?
            + 1
    };
    let operation = if state.operation == "create" {
        "create"
    } else {
        "update"
    };
    let base_version = if operation == "create" {
        None
    } else {
        state.base_version.or(state.current_version)
    };
    let row = NewDraftNode {
        changeset_id: input.changeset_id,
        id: node_id,
        operation,
        base_version,
        mc_x: Some(input.geom.x),
        mc_y: Some(input.geom.y),
        mc_z: Some(input.geom.z),
        tags: Some(tags),
        staged_by_user_id: user,
    };
    insert_into(draft::nodes::table)
        .values(&row)
        .on_conflict((draft::nodes::changeset_id, draft::nodes::id))
        .do_update()
        .set((
            draft::nodes::operation.eq(operation),
            draft::nodes::base_version.eq(base_version),
            draft::nodes::mc_x.eq(row.mc_x),
            draft::nodes::mc_y.eq(row.mc_y),
            draft::nodes::mc_z.eq(row.mc_z),
            draft::nodes::tags.eq(row.tags.clone()),
            draft::nodes::staged_by_user_id.eq(row.staged_by_user_id),
        ))
        .execute(c)?;
    Ok(IdRow {
        id: node_id,
        version: proposed_version,
    })
}

pub(crate) fn delete_node_typed(
    c: &mut database::DatabaseConnection,
    node_id: i64,
    input: DeleteInput,
    user: i64,
) -> Result<(), database::DatabaseError> {
    let state = node_state(c, input.changeset_id, node_id)?;
    let want = expected_version(&state)?;
    if input.expected_version != want {
        return Err(std::io::Error::other("version conflict").into());
    }
    if state.operation == "create" {
        delete(
            draft::nodes::table
                .filter(draft::nodes::changeset_id.eq(input.changeset_id))
                .filter(draft::nodes::id.eq(node_id)),
        )
        .execute(c)?;
        return Ok(());
    }
    let base = state.base_version.or(state.current_version).unwrap();
    let row = NewDraftNode {
        changeset_id: input.changeset_id,
        id: node_id,
        operation: "delete",
        base_version: Some(base),
        mc_x: None,
        mc_y: None,
        mc_z: None,
        tags: None,
        staged_by_user_id: user,
    };
    insert_into(draft::nodes::table)
        .values(&row)
        .on_conflict((draft::nodes::changeset_id, draft::nodes::id))
        .do_update()
        .set((
            draft::nodes::operation.eq("delete"),
            draft::nodes::base_version.eq(base),
            draft::nodes::mc_x.eq(None::<f64>),
            draft::nodes::mc_y.eq(None::<f64>),
            draft::nodes::mc_z.eq(None::<f64>),
            draft::nodes::tags.eq(None::<Value>),
            draft::nodes::staged_by_user_id.eq(user),
        ))
        .execute(c)?;
    Ok(())
}

pub(crate) fn way_json(row: (i64, i32, String, DbJson, Vec<i64>)) -> Value {
    let (id, version, geometry_kind, tags, node_refs) = row;
    serde_json::json!({"id": id, "version": version, "geometryKind": geometry_kind, "nodeRefs": node_refs, "tags": tags})
}

pub(crate) fn relation_json(row: (i64, i32, String, DbJson)) -> Value {
    let (id, version, relation_type, tags) = row;
    serde_json::json!({"id": id, "version": version, "relationType": relation_type, "tags": tags})
}

macro_rules! state_helper {
    ($name:ident, $draft:ident, $core:ident, $message:literal) => {
        pub(crate) fn $name(
            c: &mut database::DatabaseConnection,
            changeset_id: i64,
            id: i64,
        ) -> Result<EntityState, database::DatabaseError> {
            let draft_row = draft::$draft::table
                .filter(draft::$draft::changeset_id.eq(changeset_id))
                .filter(draft::$draft::id.eq(id))
                .select((draft::$draft::operation, draft::$draft::base_version))
                .first::<(String, Option<i32>)>(c)
                .optional()?;
            let current = core::$core::table
                .filter(core::$core::id.eq(id))
                .filter(core::$core::deleted_at.is_null())
                .select(core::$core::version)
                .first::<i32>(c)
                .optional()?;
            draft_row
                .map(|(operation, base_version)| EntityState {
                    operation,
                    base_version,
                    current_version: current,
                })
                .or_else(|| {
                    current.map(|version| EntityState {
                        operation: "core".into(),
                        base_version: None,
                        current_version: Some(version),
                    })
                })
                .ok_or_else(|| std::io::Error::other($message).into())
        }
    };
}
state_helper!(node_state, nodes, nodes, "node not found");
state_helper!(way_state, ways, ways, "way not found");
state_helper!(relation_state, relations, relations, "relation not found");

pub(crate) fn expected_version(state: &EntityState) -> Result<i32, database::DatabaseError> {
    if state.operation == "create" {
        return Ok(1);
    }
    let base = state
        .base_version
        .or(state.current_version)
        .ok_or_else(|| std::io::Error::other("entity not found"))?;
    Ok(if state.base_version.is_some() {
        base + 1
    } else {
        base
    })
}

pub(crate) fn proposed_version(state: &EntityState) -> Result<i32, database::DatabaseError> {
    if state.operation == "create" {
        return Ok(1);
    }
    Ok(state
        .base_version
        .or(state.current_version)
        .ok_or_else(|| std::io::Error::other("entity not found"))?
        + 1)
}

pub(crate) fn lock_owned_changeset(
    c: &mut database::DatabaseConnection,
    changeset_id: i64,
    user: i64,
) -> Result<(), database::DatabaseError> {
    let row = core::changesets::table
        .filter(core::changesets::id.eq(changeset_id))
        .filter(core::changesets::created_by_user_id.eq(user))
        .filter(core::changesets::status.eq("open"))
        .select(core::changesets::id)
        .first::<i64>(c)
        .optional()?;
    row.map(|_| ())
        .ok_or_else(|| std::io::Error::other("changeset not found or not owned").into())
}

pub(crate) fn create_way_typed(
    c: &mut database::DatabaseConnection,
    input: WayInput,
    user: i64,
) -> Result<IdRow, database::DatabaseError> {
    if !effective_nodes_exist(c, input.changeset_id, &input.node_refs)? {
        return Err(std::io::Error::other("invalid reference").into());
    }
    let id = diesel::select(diesel::dsl::sql::<diesel::sql_types::BigInt>(
        "nextval('core.way_id_seq'::regclass)",
    ))
    .get_result::<i64>(c)?;
    let tags = serde_json::to_value(input.tags)?;
    insert_into(draft::ways::table)
        .values(NewDraftWay {
            changeset_id: input.changeset_id,
            id,
            operation: "create",
            base_version: None,
            geometry_kind: Some(input.geometry_kind.as_str()),
            is_closed: Some(input.node_refs.first() == input.node_refs.last()),
            tags: Some(tags),
            staged_by_user_id: user,
        })
        .execute(c)?;
    let children: Vec<_> = input
        .node_refs
        .into_iter()
        .enumerate()
        .map(|(seq, node_id)| NewDraftWayNode {
            changeset_id: input.changeset_id,
            way_id: id,
            seq: seq as i32,
            node_id,
        })
        .collect();
    for chunk in children.chunks(INSERT_BATCH_SIZE) {
        insert_into(draft::way_nodes::table)
            .values(chunk)
            .execute(c)?;
    }
    Ok(IdRow { id, version: 1 })
}

pub(crate) fn patch_way_typed(
    c: &mut database::DatabaseConnection,
    way_id: i64,
    input: WayPatch,
    user: i64,
) -> Result<IdRow, database::DatabaseError> {
    if !effective_nodes_exist(c, input.changeset_id, &input.node_refs)? {
        return Err(std::io::Error::other("invalid reference").into());
    }
    let state = way_state(c, input.changeset_id, way_id)?;
    let version = expected_version(&state)?;
    if input.expected_version != version {
        return Err(std::io::Error::other("version conflict").into());
    }
    let operation = if state.operation == "create" {
        "create"
    } else {
        "update"
    };
    let base_version = if operation == "create" {
        None
    } else {
        state.base_version.or(state.current_version)
    };
    let tags = serde_json::to_value(input.tags)?;
    let row = NewDraftWay {
        changeset_id: input.changeset_id,
        id: way_id,
        operation,
        base_version,
        geometry_kind: Some(input.geometry_kind.as_str()),
        is_closed: Some(input.node_refs.first() == input.node_refs.last()),
        tags: Some(tags),
        staged_by_user_id: user,
    };
    insert_into(draft::ways::table)
        .values(&row)
        .on_conflict((draft::ways::changeset_id, draft::ways::id))
        .do_update()
        .set((
            draft::ways::operation.eq(operation),
            draft::ways::base_version.eq(base_version),
            draft::ways::geometry_kind.eq(row.geometry_kind),
            draft::ways::is_closed.eq(row.is_closed),
            draft::ways::tags.eq(row.tags.clone()),
            draft::ways::staged_by_user_id.eq(user),
        ))
        .execute(c)?;
    delete(
        draft::way_nodes::table
            .filter(draft::way_nodes::changeset_id.eq(input.changeset_id))
            .filter(draft::way_nodes::way_id.eq(way_id)),
    )
    .execute(c)?;
    let children: Vec<_> = input
        .node_refs
        .into_iter()
        .enumerate()
        .map(|(seq, node_id)| NewDraftWayNode {
            changeset_id: input.changeset_id,
            way_id,
            seq: seq as i32,
            node_id,
        })
        .collect();
    for chunk in children.chunks(INSERT_BATCH_SIZE) {
        insert_into(draft::way_nodes::table)
            .values(chunk)
            .execute(c)?;
    }
    let proposed_version = proposed_version(&state)?;
    Ok(IdRow {
        id: way_id,
        version: proposed_version,
    })
}

pub(crate) fn delete_way_typed(
    c: &mut database::DatabaseConnection,
    way_id: i64,
    input: DeleteInput,
    user: i64,
) -> Result<(), database::DatabaseError> {
    let state = way_state(c, input.changeset_id, way_id)?;
    let version = expected_version(&state)?;
    if input.expected_version != version {
        return Err(std::io::Error::other("version conflict").into());
    }
    if state.operation == "create" {
        delete(
            draft::ways::table
                .filter(draft::ways::changeset_id.eq(input.changeset_id))
                .filter(draft::ways::id.eq(way_id)),
        )
        .execute(c)?;
        return Ok(());
    }
    let base = state.base_version.or(state.current_version).unwrap();
    let row = NewDraftWay {
        changeset_id: input.changeset_id,
        id: way_id,
        operation: "delete",
        base_version: Some(base),
        geometry_kind: None,
        is_closed: None,
        tags: None,
        staged_by_user_id: user,
    };
    insert_into(draft::ways::table)
        .values(&row)
        .on_conflict((draft::ways::changeset_id, draft::ways::id))
        .do_update()
        .set((
            draft::ways::operation.eq("delete"),
            draft::ways::base_version.eq(base),
            draft::ways::geometry_kind.eq(None::<String>),
            draft::ways::is_closed.eq(None::<bool>),
            draft::ways::tags.eq(None::<Value>),
            draft::ways::staged_by_user_id.eq(user),
        ))
        .execute(c)?;
    Ok(())
}

pub(crate) fn create_relation_typed(
    c: &mut database::DatabaseConnection,
    input: RelationInput,
    user: i64,
) -> Result<IdRow, database::DatabaseError> {
    for member in &input.members {
        if !member_exists(c, input.changeset_id, member)? {
            return Err(std::io::Error::other("invalid reference").into());
        }
    }
    let id = diesel::select(diesel::dsl::sql::<diesel::sql_types::BigInt>(
        "nextval('core.relation_id_seq'::regclass)",
    ))
    .get_result::<i64>(c)?;
    let tags = serde_json::to_value(input.tags)?;
    insert_into(draft::relations::table)
        .values(NewDraftRelation {
            changeset_id: input.changeset_id,
            id,
            operation: "create",
            base_version: None,
            relation_type: Some(&input.relation_type),
            tags: Some(tags),
            staged_by_user_id: user,
        })
        .execute(c)?;
    let members: Vec<_> = input
        .members
        .iter()
        .enumerate()
        .map(|(seq, member)| NewDraftMember {
            changeset_id: input.changeset_id,
            relation_id: id,
            seq: seq as i32,
            member_type: &member.member_type,
            member_id: member.member_id,
            role: member.role.as_deref(),
        })
        .collect();
    for chunk in members.chunks(INSERT_BATCH_SIZE) {
        insert_into(draft::relation_members::table)
            .values(chunk)
            .execute(c)?;
    }
    Ok(IdRow { id, version: 1 })
}

pub(crate) fn patch_relation_typed(
    c: &mut database::DatabaseConnection,
    relation_id: i64,
    input: RelationPatch,
    user: i64,
) -> Result<IdRow, database::DatabaseError> {
    for member in &input.members {
        if !member_exists(c, input.changeset_id, member)? {
            return Err(std::io::Error::other("invalid reference").into());
        }
    }
    let state = relation_state(c, input.changeset_id, relation_id)?;
    let version = expected_version(&state)?;
    if input.expected_version != version {
        return Err(std::io::Error::other("version conflict").into());
    }
    let operation = if state.operation == "create" {
        "create"
    } else {
        "update"
    };
    let base_version = if operation == "create" {
        None
    } else {
        state.base_version.or(state.current_version)
    };
    let tags = serde_json::to_value(input.tags)?;
    let row = NewDraftRelation {
        changeset_id: input.changeset_id,
        id: relation_id,
        operation,
        base_version,
        relation_type: Some(&input.relation_type),
        tags: Some(tags),
        staged_by_user_id: user,
    };
    insert_into(draft::relations::table)
        .values(&row)
        .on_conflict((draft::relations::changeset_id, draft::relations::id))
        .do_update()
        .set((
            draft::relations::operation.eq(operation),
            draft::relations::base_version.eq(base_version),
            draft::relations::relation_type.eq(row.relation_type),
            draft::relations::tags.eq(row.tags.clone()),
            draft::relations::staged_by_user_id.eq(user),
        ))
        .execute(c)?;
    delete(
        draft::relation_members::table
            .filter(draft::relation_members::changeset_id.eq(input.changeset_id))
            .filter(draft::relation_members::relation_id.eq(relation_id)),
    )
    .execute(c)?;
    let members: Vec<_> = input
        .members
        .iter()
        .enumerate()
        .map(|(seq, member)| NewDraftMember {
            changeset_id: input.changeset_id,
            relation_id,
            seq: seq as i32,
            member_type: &member.member_type,
            member_id: member.member_id,
            role: member.role.as_deref(),
        })
        .collect();
    for chunk in members.chunks(INSERT_BATCH_SIZE) {
        insert_into(draft::relation_members::table)
            .values(chunk)
            .execute(c)?;
    }
    let proposed_version = proposed_version(&state)?;
    Ok(IdRow {
        id: relation_id,
        version: proposed_version,
    })
}

pub(crate) fn delete_relation_typed(
    c: &mut database::DatabaseConnection,
    relation_id: i64,
    input: DeleteInput,
    user: i64,
) -> Result<(), database::DatabaseError> {
    let state = relation_state(c, input.changeset_id, relation_id)?;
    let version = expected_version(&state)?;
    if input.expected_version != version {
        return Err(std::io::Error::other("version conflict").into());
    }
    if state.operation == "create" {
        delete(
            draft::relations::table
                .filter(draft::relations::changeset_id.eq(input.changeset_id))
                .filter(draft::relations::id.eq(relation_id)),
        )
        .execute(c)?;
        return Ok(());
    }
    let base = state.base_version.or(state.current_version).unwrap();
    let row = NewDraftRelation {
        changeset_id: input.changeset_id,
        id: relation_id,
        operation: "delete",
        base_version: Some(base),
        relation_type: None,
        tags: None,
        staged_by_user_id: user,
    };
    insert_into(draft::relations::table)
        .values(&row)
        .on_conflict((draft::relations::changeset_id, draft::relations::id))
        .do_update()
        .set((
            draft::relations::operation.eq("delete"),
            draft::relations::base_version.eq(base),
            draft::relations::relation_type.eq(None::<String>),
            draft::relations::tags.eq(None::<Value>),
            draft::relations::staged_by_user_id.eq(user),
        ))
        .execute(c)?;
    Ok(())
}

pub(crate) fn effective_nodes_exist(
    c: &mut database::DatabaseConnection,
    changeset_id: i64,
    refs: &[i64],
) -> Result<bool, database::DatabaseError> {
    let core_ids: HashSet<i64> = core::nodes::table
        .filter(core::nodes::id.eq_any(refs))
        .filter(core::nodes::deleted_at.is_null())
        .select(core::nodes::id)
        .load(c)?
        .into_iter()
        .collect();
    let drafts: HashSet<i64> = draft::nodes::table
        .filter(draft::nodes::changeset_id.eq(changeset_id))
        .filter(draft::nodes::id.eq_any(refs))
        .filter(draft::nodes::operation.eq_any(["create", "update"]))
        .select(draft::nodes::id)
        .load(c)?
        .into_iter()
        .collect();
    let deleted: HashSet<i64> = draft::nodes::table
        .filter(draft::nodes::changeset_id.eq(changeset_id))
        .filter(draft::nodes::id.eq_any(refs))
        .filter(draft::nodes::operation.eq("delete"))
        .select(draft::nodes::id)
        .load(c)?
        .into_iter()
        .collect();
    Ok(refs
        .iter()
        .all(|id| (drafts.contains(id) || core_ids.contains(id)) && !deleted.contains(id)))
}

pub(crate) fn member_exists(
    c: &mut database::DatabaseConnection,
    changeset_id: i64,
    member: &RelationMember,
) -> Result<bool, database::DatabaseError> {
    let deleted = match member.member_type.as_str() {
        "node" => draft::nodes::table
            .filter(draft::nodes::changeset_id.eq(changeset_id))
            .filter(draft::nodes::id.eq(member.member_id))
            .filter(draft::nodes::operation.eq("delete"))
            .select(draft::nodes::id)
            .first::<i64>(c)
            .optional()?
            .is_some(),
        "way" => draft::ways::table
            .filter(draft::ways::changeset_id.eq(changeset_id))
            .filter(draft::ways::id.eq(member.member_id))
            .filter(draft::ways::operation.eq("delete"))
            .select(draft::ways::id)
            .first::<i64>(c)
            .optional()?
            .is_some(),
        "relation" => draft::relations::table
            .filter(draft::relations::changeset_id.eq(changeset_id))
            .filter(draft::relations::id.eq(member.member_id))
            .filter(draft::relations::operation.eq("delete"))
            .select(draft::relations::id)
            .first::<i64>(c)
            .optional()?
            .is_some(),
        _ => false,
    };
    if deleted {
        return Ok(false);
    }
    let exists = match member.member_type.as_str() {
        "node" => core::nodes::table
            .filter(core::nodes::id.eq(member.member_id))
            .filter(core::nodes::deleted_at.is_null())
            .select(core::nodes::id)
            .first::<i64>(c)
            .optional()?
            .is_some(),
        "way" => core::ways::table
            .filter(core::ways::id.eq(member.member_id))
            .filter(core::ways::deleted_at.is_null())
            .select(core::ways::id)
            .first::<i64>(c)
            .optional()?
            .is_some(),
        "relation" => core::relations::table
            .filter(core::relations::id.eq(member.member_id))
            .filter(core::relations::deleted_at.is_null())
            .select(core::relations::id)
            .first::<i64>(c)
            .optional()?
            .is_some(),
        _ => false,
    };
    if exists {
        return Ok(true);
    }
    let draft_exists = match member.member_type.as_str() {
        "node" => draft::nodes::table
            .filter(draft::nodes::changeset_id.eq(changeset_id))
            .filter(draft::nodes::id.eq(member.member_id))
            .filter(draft::nodes::operation.eq_any(["create", "update"]))
            .select(draft::nodes::id)
            .first::<i64>(c)
            .optional()?
            .is_some(),
        "way" => draft::ways::table
            .filter(draft::ways::changeset_id.eq(changeset_id))
            .filter(draft::ways::id.eq(member.member_id))
            .filter(draft::ways::operation.eq_any(["create", "update"]))
            .select(draft::ways::id)
            .first::<i64>(c)
            .optional()?
            .is_some(),
        "relation" => draft::relations::table
            .filter(draft::relations::changeset_id.eq(changeset_id))
            .filter(draft::relations::id.eq(member.member_id))
            .filter(draft::relations::operation.eq_any(["create", "update"]))
            .select(draft::relations::id)
            .first::<i64>(c)
            .optional()?
            .is_some(),
        _ => false,
    };
    Ok(draft_exists)
}
