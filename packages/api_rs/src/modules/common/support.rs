use crate::database;
use poem::{Result, session::Session};

pub(crate) fn session_user(session: &Session) -> Result<String> {
    session
        .get("username")
        .ok_or_else(|| poem::Error::from_status(poem::http::StatusCode::UNAUTHORIZED))
}

pub(crate) fn db_error(error: database::DatabaseError) -> poem::Error {
    poem::Error::from_string(
        error.to_string(),
        poem::http::StatusCode::INTERNAL_SERVER_ERROR,
    )
}
