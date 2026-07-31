use poem_openapi::Object;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::modules::Nullable;

#[derive(Debug, poem_openapi::Enum, Serialize, Deserialize, Clone)]
#[oai(rename_all = "lowercase")]
pub enum GeometryKind {
    Line,
    Area,
}

impl GeometryKind {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Line => "line",
            Self::Area => "area",
        }
    }
}

#[derive(Debug, poem_openapi::Enum, Serialize, Deserialize, Clone)]
#[oai(rename_all = "lowercase")]
pub enum ChangesetStatus {
    Open,
    Published,
    Abandoned,
}

#[derive(Debug, Object, Serialize, Deserialize, Clone)]
#[oai(rename_all = "camelCase")]
pub struct User {
    pub id: i64,
    pub username: String,
}

#[derive(Debug, Object, Serialize, Deserialize, Clone)]
#[oai(rename_all = "camelCase")]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct NodeInput {
    pub changeset_id: i64,
    pub geom: Point,
    pub feature_type: String,
    pub tags: std::collections::BTreeMap<String, String>,
}
#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct NodePatch {
    pub changeset_id: i64,
    pub expected_version: i32,
    pub geom: Point,
    pub feature_type: String,
    pub tags: std::collections::BTreeMap<String, String>,
}
#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct DeleteInput {
    pub changeset_id: i64,
    pub expected_version: i32,
}
#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct IdVersion {
    pub id: i64,
    pub version: i32,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct WayInput {
    pub changeset_id: i64,
    pub feature_type: String,
    pub geometry_kind: GeometryKind,
    pub node_refs: Vec<i64>,
    pub tags: std::collections::BTreeMap<String, String>,
}
#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct WayPatch {
    pub changeset_id: i64,
    pub expected_version: i32,
    pub feature_type: String,
    pub geometry_kind: GeometryKind,
    pub node_refs: Vec<i64>,
    pub tags: std::collections::BTreeMap<String, String>,
}
#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct RelationMember {
    pub member_type: String,
    pub member_id: i64,
    pub role: Option<String>,
}
#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct RelationInput {
    pub changeset_id: i64,
    pub relation_type: String,
    pub members: Vec<RelationMember>,
    pub tags: std::collections::BTreeMap<String, String>,
}
#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct RelationPatch {
    pub changeset_id: i64,
    pub expected_version: i32,
    pub relation_type: String,
    pub members: Vec<RelationMember>,
    pub tags: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetInput {
    pub comment: Option<String>,
}
#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct Changeset {
    pub id: i64,
    pub status: ChangesetStatus,
    pub comment: Nullable<String>,
    pub created_by: User,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub published_at: Nullable<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ViewportNode {
    pub id: i64,
    pub version: i32,
    pub geom: Point,
    pub feature_type: String,
    pub tags: BTreeMap<String, String>,
    pub deleted_at: Nullable<chrono::DateTime<chrono::Utc>>,
    pub changeset_id: i64,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ViewportWay {
    pub id: i64,
    pub version: i32,
    pub feature_type: String,
    pub geometry_kind: GeometryKind,
    pub tags: BTreeMap<String, String>,
    pub is_closed: bool,
    pub deleted_at: Nullable<chrono::DateTime<chrono::Utc>>,
    pub changeset_id: i64,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ViewportWayNode {
    pub way_id: i64,
    pub seq: i32,
    pub node_id: i64,
    pub changeset_id: i64,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ViewportRelation {
    pub id: i64,
    pub version: i32,
    pub relation_type: String,
    pub tags: BTreeMap<String, String>,
    pub deleted_at: Nullable<chrono::DateTime<chrono::Utc>>,
    pub changeset_id: i64,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ViewportRelationMember {
    pub relation_id: i64,
    pub seq: i32,
    pub member_type: String,
    pub member_id: i64,
    pub role: Nullable<String>,
    pub changeset_id: i64,
}
#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct Viewport {
    pub nodes: Vec<ViewportNode>,
    pub ways: Vec<ViewportWay>,
    pub way_nodes: Vec<ViewportWayNode>,
    pub relations: Vec<ViewportRelation>,
    pub relation_members: Vec<ViewportRelationMember>,
}
