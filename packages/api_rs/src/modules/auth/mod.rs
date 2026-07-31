use diesel::{
    ExpressionMethods, OptionalExtension, QueryDsl, QueryableByName, RunQueryDsl, sql_query,
    sql_types::{BigInt, Text},
};
use poem::session::Session;
use poem::web::Data;
use poem_openapi::{Object, OpenApi, payload::Json};
use serde::Deserialize;

use crate::database::{self, DatabaseConnection, DatabaseError, DatabasePool};
use crate::modules::common::types::User;
use crate::modules::{NoContent, Nullable};
use crate::schema::core;
use crate::tags::CatlasTags;

/// 新規セッションの内容
#[derive(Object)]
pub struct SessionInfo {
    pub user: Nullable<User>,
}

#[derive(Object, Deserialize)]
#[oai(rename_all = "camelCase")]
#[oai(deny_unknown_fields)]
pub struct CreateSession {
    pub user_id: String,
}

#[derive(QueryableByName)]
struct UserRow {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = Text)]
    username: String,
    #[diesel(sql_type = Text)]
    user_id: String,
}

pub struct AuthModule;

pub(crate) fn provision_user(
    connection: &mut DatabaseConnection,
    user_id: &str,
) -> Result<(i64, String, String), DatabaseError> {
    sql_query(
        r#"INSERT INTO core.users (user_id, username) VALUES ($1, $1)
           ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
           RETURNING id, user_id, username"#,
    )
    .bind::<Text, _>(user_id)
    .get_result::<UserRow>(connection)
    .map(|row| (row.id, row.user_id, row.username))
    .map_err(Into::into)
}

#[OpenApi(prefix_path = "/auth", tag = CatlasTags::Auth)]
impl AuthModule {
    /// セッションを取得する
    #[oai(path = "/session", method = "get")]
    async fn get_session(
        &self,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> poem::Result<Json<SessionInfo>> {
        let user_id: Option<i64> = session.get("user_id");
        let user = if let Some(user_id) = user_id {
            database::blocking(pool, move |c| {
                core::users::table
                    .filter(core::users::id.eq(user_id))
                    .select((core::users::id, core::users::user_id, core::users::username))
                    .first::<(i64, String, String)>(c)
                    .optional()
                    .map_err(Into::into)
            })
            .await
            .map_err(crate::modules::common::support::db_error)?
        } else {
            None
        };
        if user.is_none() && user_id.is_some() {
            session.purge();
        }
        Ok(Json(SessionInfo {
            user: Nullable(user.map(|(id, user_id, username)| User {
                id,
                user_id,
                username,
            })),
        }))
    }

    /// 新規セッションを発行する
    ///
    /// テスト用のセッションを発行する。
    #[oai(path = "/session", method = "post")]
    async fn create_session(
        &self,
        Json(request): Json<CreateSession>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> poem::Result<Json<SessionInfo>> {
        let user_id = request.user_id.as_str();
        if user_id.is_empty()
            || user_id.len() > 128
            || !user_id.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
            })
        {
            return Err(poem::Error::from_status(
                poem::http::StatusCode::BAD_REQUEST,
            ));
        }
        let user_id = user_id.to_owned();
        let user = database::blocking(pool, move |c| provision_user(c, &user_id))
            .await
            .map_err(crate::modules::common::support::db_error)?;
        session.renew();
        session.set("user_id", user.0);
        Ok(Json(SessionInfo {
            user: Nullable(Some(User {
                id: user.0,
                user_id: user.1,
                username: user.2,
            })),
        }))
    }

    #[oai(path = "/session", method = "delete")]
    async fn delete_session(&self, session: &Session) -> poem::Result<NoContent> {
        session.purge();
        Ok(NoContent::NoContent)
    }
}
