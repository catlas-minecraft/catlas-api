use crate::schema::{core, draft, history};
use diesel::Insertable;
use serde_json::Value;

pub(crate) type DbJson = Value;
pub(crate) const INSERT_BATCH_SIZE: usize = 1000;

pub(crate) struct IdRow {
    pub(crate) id: i64,
    pub(crate) version: i32,
}
pub(crate) struct ChangesetRow {
    pub(crate) id: i64,
    pub(crate) status: String,
    pub(crate) comment: Option<String>,
    pub(crate) created_by_user_id: i64,
    pub(crate) created_by_user_id_public: String,
    pub(crate) created_by_username: String,
    pub(crate) created_at: chrono::DateTime<chrono::Utc>,
    pub(crate) published_at: Option<chrono::DateTime<chrono::Utc>>,
}
#[derive(Insertable)]
#[diesel(table_name = draft::nodes)]
pub(crate) struct NewDraftNode<'a> {
    pub(crate) changeset_id: i64,
    pub(crate) id: i64,
    pub(crate) operation: &'a str,
    pub(crate) base_version: Option<i32>,
    pub(crate) mc_x: Option<f64>,
    pub(crate) mc_y: Option<f64>,
    pub(crate) mc_z: Option<f64>,
    pub(crate) tags: Option<Value>,
    pub(crate) staged_by_user_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = draft::ways)]
pub(crate) struct NewDraftWay<'a> {
    pub(crate) changeset_id: i64,
    pub(crate) id: i64,
    pub(crate) operation: &'a str,
    pub(crate) base_version: Option<i32>,
    pub(crate) geometry_kind: Option<&'a str>,
    pub(crate) is_closed: Option<bool>,
    pub(crate) tags: Option<Value>,
    pub(crate) staged_by_user_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = draft::relations)]
pub(crate) struct NewDraftRelation<'a> {
    pub(crate) changeset_id: i64,
    pub(crate) id: i64,
    pub(crate) operation: &'a str,
    pub(crate) base_version: Option<i32>,
    pub(crate) relation_type: Option<&'a str>,
    pub(crate) tags: Option<Value>,
    pub(crate) staged_by_user_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = draft::way_nodes)]
pub(crate) struct NewDraftWayNode {
    pub(crate) changeset_id: i64,
    pub(crate) way_id: i64,
    pub(crate) seq: i32,
    pub(crate) node_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = draft::relation_members)]
pub(crate) struct NewDraftMember<'a> {
    pub(crate) changeset_id: i64,
    pub(crate) relation_id: i64,
    pub(crate) seq: i32,
    pub(crate) member_type: &'a str,
    pub(crate) member_id: i64,
    pub(crate) role: Option<&'a str>,
}

#[derive(Insertable)]
#[diesel(table_name = core::nodes)]
pub(crate) struct NewNode {
    pub(crate) id: i64,
    pub(crate) world_id: i64,
    pub(crate) mc_x: f64,
    pub(crate) mc_y: f64,
    pub(crate) mc_z: f64,
    pub(crate) tags: Value,
    pub(crate) created_changeset_id: i64,
    pub(crate) created_by_user_id: i64,
    pub(crate) updated_by_user_id: i64,
    pub(crate) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = core::ways)]
pub(crate) struct NewWay {
    pub(crate) id: i64,
    pub(crate) world_id: i64,
    pub(crate) geometry_kind: String,
    pub(crate) is_closed: bool,
    pub(crate) tags: Value,
    pub(crate) created_changeset_id: i64,
    pub(crate) created_by_user_id: i64,
    pub(crate) updated_by_user_id: i64,
    pub(crate) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = core::relations)]
pub(crate) struct NewRelation {
    pub(crate) id: i64,
    pub(crate) world_id: i64,
    pub(crate) relation_type: String,
    pub(crate) tags: Value,
    pub(crate) created_changeset_id: i64,
    pub(crate) created_by_user_id: i64,
    pub(crate) updated_by_user_id: i64,
    pub(crate) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = core::way_nodes)]
pub(crate) struct NewWayNode {
    pub(crate) way_id: i64,
    pub(crate) world_id: i64,
    pub(crate) seq: i32,
    pub(crate) node_id: i64,
    pub(crate) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = core::relation_members)]
pub(crate) struct NewRelationMember {
    pub(crate) relation_id: i64,
    pub(crate) world_id: i64,
    pub(crate) member_type: String,
    pub(crate) member_id: i64,
    pub(crate) seq: i32,
    pub(crate) role: Option<String>,
    pub(crate) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = history::node_versions)]
pub(crate) struct NewNodeVersion {
    pub(crate) node_id: i64,
    pub(crate) version: i32,
    pub(crate) snapshot: Value,
    pub(crate) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = history::way_versions)]
pub(crate) struct NewWayVersion {
    pub(crate) way_id: i64,
    pub(crate) version: i32,
    pub(crate) snapshot: Value,
    pub(crate) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = history::way_node_versions)]
pub(crate) struct NewWayNodeVersion {
    pub(crate) way_id: i64,
    pub(crate) parent_version: i32,
    pub(crate) seq: i32,
    pub(crate) snapshot: Value,
    pub(crate) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = history::relation_versions)]
pub(crate) struct NewRelationVersion {
    pub(crate) relation_id: i64,
    pub(crate) version: i32,
    pub(crate) snapshot: Value,
    pub(crate) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = history::relation_member_versions)]
pub(crate) struct NewRelationMemberVersion {
    pub(crate) relation_id: i64,
    pub(crate) parent_version: i32,
    pub(crate) seq: i32,
    pub(crate) snapshot: Value,
    pub(crate) changeset_id: i64,
}

#[derive(Debug, Clone)]
pub(crate) struct EntityState {
    pub(crate) operation: String,
    pub(crate) base_version: Option<i32>,
    pub(crate) current_version: Option<i32>,
}
