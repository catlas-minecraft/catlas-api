use crate::database;
use crate::schema::core;
use diesel::{ExpressionMethods, OptionalExtension, QueryDsl, RunQueryDsl};
use poem::{Result, http::StatusCode, session::Session};

pub(crate) async fn resolve_world(pool: &database::DatabasePool, slug: String) -> Result<i64> {
    let id = database::blocking(pool, move |c| {
        core::worlds::table
            .filter(core::worlds::slug.eq(slug))
            .select(core::worlds::id)
            .first::<i64>(c)
            .optional()
            .map_err(Into::into)
    })
    .await
    .map_err(db_error)?;
    id.ok_or_else(|| poem::Error::from_status(StatusCode::NOT_FOUND))
}

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
    let message = error.to_string();
    if message.contains("duplicate key") && message.contains("worlds_slug") {
        return poem::Error::from_status(StatusCode::CONFLICT);
    }
    if message.contains("version conflict") || message.contains("id conflict") {
        return poem::Error::from_status(StatusCode::CONFLICT);
    }
    if message.contains("not found") || message.contains("not owned") {
        return poem::Error::from_status(StatusCode::NOT_FOUND);
    }
    if message.contains("invalid reference")
        || message.contains("invalid topology")
        || message.contains("invalid geometry")
        || message.contains("invalid node draft")
        || message.contains("invalid way draft")
        || message.contains("invalid relation draft")
    {
        return poem::Error::from_status(StatusCode::UNPROCESSABLE_ENTITY);
    }
    poem::Error::from_string(message, poem::http::StatusCode::INTERNAL_SERVER_ERROR)
}
