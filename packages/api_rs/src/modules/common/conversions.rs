use super::models::{ChangesetRow, IdRow};
use super::types::{Changeset, ChangesetStatus, IdVersion};

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
            created_by: row.created_by,
            created_at: row.created_at,
            published_at: row.published_at.into(),
        }
    }
}

impl From<IdRow> for IdVersion {
    fn from(row: IdRow) -> Self {
        Self {
            id: row.id,
            version: row.version,
        }
    }
}
