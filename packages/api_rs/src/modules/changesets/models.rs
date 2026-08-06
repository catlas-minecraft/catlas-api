use crate::modules::Nullable;
use crate::modules::common::types::{GeometryKind, Point, RelationMember, User};
use poem_openapi::Object;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, poem_openapi::Enum, Serialize, Deserialize, Clone)]
#[oai(rename_all = "lowercase")]
pub enum ChangesetStatus {
    Open,
    Published,
    Abandoned,
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
pub struct ChangesetUploadCreateNode {
    pub id: i64,
    pub geom: Point,
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetUploadModifyNode {
    pub id: i64,
    pub expected_version: i32,
    pub geom: Point,
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetUploadCreateWay {
    pub id: i64,
    pub geometry_kind: GeometryKind,
    pub node_refs: Vec<i64>,
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetUploadModifyWay {
    pub id: i64,
    pub expected_version: i32,
    pub geometry_kind: GeometryKind,
    pub node_refs: Vec<i64>,
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetUploadCreateRelation {
    pub id: i64,
    pub relation_type: String,
    pub members: Vec<RelationMember>,
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetUploadModifyRelation {
    pub id: i64,
    pub expected_version: i32,
    pub relation_type: String,
    pub members: Vec<RelationMember>,
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetUploadDeleteEntity {
    pub id: i64,
    pub expected_version: i32,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetUploadCreate {
    pub nodes: Vec<ChangesetUploadCreateNode>,
    pub ways: Vec<ChangesetUploadCreateWay>,
    pub relations: Vec<ChangesetUploadCreateRelation>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetUploadModify {
    pub nodes: Vec<ChangesetUploadModifyNode>,
    pub ways: Vec<ChangesetUploadModifyWay>,
    pub relations: Vec<ChangesetUploadModifyRelation>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetUploadDeleteGroup {
    pub nodes: Vec<ChangesetUploadDeleteEntity>,
    pub ways: Vec<ChangesetUploadDeleteEntity>,
    pub relations: Vec<ChangesetUploadDeleteEntity>,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetUploadRequest {
    pub create: ChangesetUploadCreate,
    pub modify: ChangesetUploadModify,
    pub delete: ChangesetUploadDeleteGroup,
}

#[derive(Debug, Object, Serialize, Deserialize, Clone)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetUploadDiffEntry {
    pub old_id: i64,
    pub new_id: i64,
    pub new_version: i32,
}

#[derive(Debug, Object, Serialize, Deserialize, Clone)]
#[oai(rename_all = "camelCase")]
pub struct ChangesetUploadDiffResult {
    pub nodes: Vec<ChangesetUploadDiffEntry>,
    pub ways: Vec<ChangesetUploadDiffEntry>,
    pub relations: Vec<ChangesetUploadDiffEntry>,
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

impl From<ChangesetRow> for Changeset {
    fn from(row: ChangesetRow) -> Self {
        Self {
            id: row.id,
            status: match row.status.as_str() {
                "open" => ChangesetStatus::Open,
                "published" => ChangesetStatus::Published,
                "abandoned" => ChangesetStatus::Abandoned,
                status => unreachable!("invalid changeset status from database: {status}"),
            },
            comment: row.comment.into(),
            created_by: User {
                id: row.created_by_user_id,
                user_id: row.created_by_user_id_public,
                username: row.created_by_username,
            },
            created_at: row.created_at,
            published_at: row.published_at.into(),
        }
    }
}
