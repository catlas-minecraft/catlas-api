use crate::database;
use crate::schema::core;
use diesel::{ExpressionMethods, OptionalExtension, QueryDsl, RunQueryDsl};
use poem::{Result, http::StatusCode, session::Session};

pub(crate) async fn session_user(session: &Session, pool: &database::DatabasePool) -> Result<i64> {
    let user_id: i64 = session
        .get("user_id")
        .ok_or_else(|| poem::Error::from_status(StatusCode::UNAUTHORIZED))?;
    let exists = database::blocking(pool, move |c| {
        core::users::table
            .filter(core::users::id.eq(user_id))
            .select(core::users::id)
            .first::<i64>(c)
            .optional()
            .map_err(Into::into)
    })
    .await
    .map_err(db_error)?;
    exists.ok_or_else(|| poem::Error::from_status(StatusCode::UNAUTHORIZED))
}

pub(crate) fn db_error(error: database::DatabaseError) -> poem::Error {
    poem::Error::from_string(
        error.to_string(),
        poem::http::StatusCode::INTERNAL_SERVER_ERROR,
    )
}
