use super::models::IdRow;
use super::types::IdVersion;

impl From<IdRow> for IdVersion {
    fn from(row: IdRow) -> Self {
        Self {
            id: row.id,
            version: row.version,
        }
    }
}
