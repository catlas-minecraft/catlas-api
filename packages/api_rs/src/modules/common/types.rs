use poem_openapi::Object;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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

#[derive(Debug, Object, Serialize, Deserialize, Clone)]
#[oai(rename_all = "camelCase")]
pub struct User {
    pub id: i64,
    pub user_id: String,
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
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct NodePatch {
    pub changeset_id: i64,
    pub expected_version: i32,
    pub geom: Point,
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct WayInput {
    pub changeset_id: i64,
    pub geometry_kind: GeometryKind,
    pub node_refs: Vec<i64>,
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct WayPatch {
    pub changeset_id: i64,
    pub expected_version: i32,
    pub geometry_kind: GeometryKind,
    pub node_refs: Vec<i64>,
    pub tags: BTreeMap<String, String>,
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
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct RelationPatch {
    pub changeset_id: i64,
    pub expected_version: i32,
    pub relation_type: String,
    pub members: Vec<RelationMember>,
    pub tags: BTreeMap<String, String>,
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
