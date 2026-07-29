use poem_openapi::Object;
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    pub geometry_kind: String,
    pub node_refs: Vec<i64>,
    pub tags: std::collections::BTreeMap<String, String>,
}
#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct WayPatch {
    pub changeset_id: i64,
    pub expected_version: i32,
    pub feature_type: String,
    pub geometry_kind: String,
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
    pub status: String,
    pub comment: Option<String>,
    pub created_by: String,
}
#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct Viewport {
    pub nodes: Vec<Value>,
    pub ways: Vec<Value>,
    pub way_nodes: Vec<Value>,
    pub relations: Vec<Value>,
    pub relation_members: Vec<Value>,
}
