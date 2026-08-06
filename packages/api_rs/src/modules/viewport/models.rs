use crate::modules::Nullable;
use crate::modules::common::types::{GeometryKind, Point};
use poem_openapi::Object;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ViewportNode {
    pub id: i64,
    pub version: i32,
    pub geom: Point,
    pub tags: BTreeMap<String, String>,
    pub deleted_at: Nullable<chrono::DateTime<chrono::Utc>>,
    pub changeset_id: i64,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ViewportWay {
    pub id: i64,
    pub version: i32,
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
