use crate::modules::common::types::User;
use poem_openapi::Object;
use serde::{Deserialize, Serialize};

#[derive(Debug, Object, Serialize, Deserialize, Clone)]
#[oai(rename_all = "camelCase")]
pub struct World {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub created_by: User,
}

#[derive(Debug, Object, Serialize, Deserialize)]
#[oai(rename_all = "camelCase")]
pub struct WorldInput {
    pub slug: String,
    pub name: String,
}
