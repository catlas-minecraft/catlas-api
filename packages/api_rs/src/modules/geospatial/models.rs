use crate::schema::{core, draft, history};
use diesel::Insertable;
use serde_json::Value;

pub(super) type DbJson = Value;
pub(super) const INSERT_BATCH_SIZE: usize = 1000;

pub(super) struct IdRow {
    pub(super) id: i64,
    pub(super) version: i32,
}
pub(super) struct ChangesetRow {
    pub(super) id: i64,
    pub(super) status: String,
    pub(super) comment: Option<String>,
    pub(super) created_by: String,
}
#[derive(Insertable)]
#[diesel(table_name = draft::nodes)]
pub(super) struct NewDraftNode<'a> {
    pub(super) changeset_id: i64,
    pub(super) id: i64,
    pub(super) operation: &'a str,
    pub(super) base_version: Option<i32>,
    pub(super) mc_x: Option<f64>,
    pub(super) mc_y: Option<f64>,
    pub(super) mc_z: Option<f64>,
    pub(super) feature_type: Option<&'a str>,
    pub(super) tags: Option<Value>,
    pub(super) staged_by: &'a str,
}
#[derive(Insertable)]
#[diesel(table_name = draft::ways)]
pub(super) struct NewDraftWay<'a> {
    pub(super) changeset_id: i64,
    pub(super) id: i64,
    pub(super) operation: &'a str,
    pub(super) base_version: Option<i32>,
    pub(super) feature_type: Option<&'a str>,
    pub(super) geometry_kind: Option<&'a str>,
    pub(super) is_closed: Option<bool>,
    pub(super) tags: Option<Value>,
    pub(super) staged_by: &'a str,
}
#[derive(Insertable)]
#[diesel(table_name = draft::relations)]
pub(super) struct NewDraftRelation<'a> {
    pub(super) changeset_id: i64,
    pub(super) id: i64,
    pub(super) operation: &'a str,
    pub(super) base_version: Option<i32>,
    pub(super) relation_type: Option<&'a str>,
    pub(super) tags: Option<Value>,
    pub(super) staged_by: &'a str,
}
#[derive(Insertable)]
#[diesel(table_name = draft::way_nodes)]
pub(super) struct NewDraftWayNode {
    pub(super) changeset_id: i64,
    pub(super) way_id: i64,
    pub(super) seq: i32,
    pub(super) node_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = draft::relation_members)]
pub(super) struct NewDraftMember<'a> {
    pub(super) changeset_id: i64,
    pub(super) relation_id: i64,
    pub(super) seq: i32,
    pub(super) member_type: &'a str,
    pub(super) member_id: i64,
    pub(super) role: Option<&'a str>,
}

#[derive(Insertable)]
#[diesel(table_name = core::nodes)]
pub(super) struct NewNode {
    pub(super) id: i64,
    pub(super) mc_x: f64,
    pub(super) mc_y: f64,
    pub(super) mc_z: f64,
    pub(super) feature_type: String,
    pub(super) tags: Value,
    pub(super) created_changeset_id: i64,
    pub(super) created_by: String,
    pub(super) updated_by: String,
    pub(super) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = core::ways)]
pub(super) struct NewWay {
    pub(super) id: i64,
    pub(super) feature_type: String,
    pub(super) geometry_kind: String,
    pub(super) is_closed: bool,
    pub(super) tags: Value,
    pub(super) created_changeset_id: i64,
    pub(super) created_by: String,
    pub(super) updated_by: String,
    pub(super) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = core::relations)]
pub(super) struct NewRelation {
    pub(super) id: i64,
    pub(super) relation_type: String,
    pub(super) tags: Value,
    pub(super) created_changeset_id: i64,
    pub(super) created_by: String,
    pub(super) updated_by: String,
    pub(super) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = core::way_nodes)]
pub(super) struct NewWayNode {
    pub(super) way_id: i64,
    pub(super) seq: i32,
    pub(super) node_id: i64,
    pub(super) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = core::relation_members)]
pub(super) struct NewRelationMember {
    pub(super) relation_id: i64,
    pub(super) member_type: String,
    pub(super) member_id: i64,
    pub(super) seq: i32,
    pub(super) role: Option<String>,
    pub(super) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = history::node_versions)]
pub(super) struct NewNodeVersion {
    pub(super) node_id: i64,
    pub(super) version: i32,
    pub(super) snapshot: Value,
    pub(super) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = history::way_versions)]
pub(super) struct NewWayVersion {
    pub(super) way_id: i64,
    pub(super) version: i32,
    pub(super) snapshot: Value,
    pub(super) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = history::way_node_versions)]
pub(super) struct NewWayNodeVersion {
    pub(super) way_id: i64,
    pub(super) parent_version: i32,
    pub(super) seq: i32,
    pub(super) snapshot: Value,
    pub(super) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = history::relation_versions)]
pub(super) struct NewRelationVersion {
    pub(super) relation_id: i64,
    pub(super) version: i32,
    pub(super) snapshot: Value,
    pub(super) changeset_id: i64,
}
#[derive(Insertable)]
#[diesel(table_name = history::relation_member_versions)]
pub(super) struct NewRelationMemberVersion {
    pub(super) relation_id: i64,
    pub(super) parent_version: i32,
    pub(super) seq: i32,
    pub(super) snapshot: Value,
    pub(super) changeset_id: i64,
}

#[derive(Debug, Clone)]
pub(super) struct EntityState {
    pub(super) operation: String,
    pub(super) base_version: Option<i32>,
    pub(super) current_version: Option<i32>,
}
