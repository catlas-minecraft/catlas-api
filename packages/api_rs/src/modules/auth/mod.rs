mod oidc;

pub use oidc::AuthState;
#[cfg(test)]
pub(crate) use oidc::provision_oidc_user;

use diesel::upsert::excluded;
use diesel::{ExpressionMethods, OptionalExtension, QueryDsl, RunQueryDsl, insert_into};
use poem::session::Session;
use poem::web::Data;
use poem_openapi::{
    ApiResponse, Object, OpenApi,
    param::Query,
    payload::{Json, Response},
};
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

#[derive(Object)]
#[oai(rename_all = "camelCase")]
pub struct AuthConfigInfo {
    pub oidc_enabled: bool,
    pub developer_auth_enabled: bool,
}

#[derive(ApiResponse)]
#[oai(header(name = "Location", ty = "String"))]
pub enum AuthRedirectResponse {
    /// Browser redirect to the identity provider or the frontend.
    #[oai(status = 303)]
    Redirect,
}

#[derive(Object, Deserialize)]
#[oai(rename_all = "camelCase")]
#[oai(deny_unknown_fields)]
pub struct CreateSession {
    pub user_id: String,
}

pub struct AuthModule;

pub(crate) fn provision_user(
    connection: &mut DatabaseConnection,
    user_id: &str,
) -> Result<(i64, String, String), DatabaseError> {
    insert_into(core::users::table)
        .values((
            core::users::user_id.eq(user_id),
            core::users::username.eq(user_id),
        ))
        .on_conflict(core::users::user_id)
        .do_update()
        .set(core::users::user_id.eq(excluded(core::users::user_id)))
        .returning((core::users::id, core::users::user_id, core::users::username))
        .get_result::<(i64, String, String)>(connection)
        .map_err(Into::into)
}

#[OpenApi(prefix_path = "/auth", tag = CatlasTags::Auth)]
impl AuthModule {
    /// OIDCログインを開始する
    #[oai(path = "/oidc/login", method = "get")]
    async fn oidc_login(
        &self,
        #[oai(name = "returnTo")] Query(return_to): Query<Option<String>>,
        session: &Session,
        Data(auth): Data<&AuthState>,
    ) -> poem::Result<Response<AuthRedirectResponse>> {
        oidc::begin_login(return_to, session, auth).await
    }

    /// OIDCログインのcallbackを処理する
    #[oai(path = "/oidc/callback", method = "get")]
    async fn oidc_callback(
        &self,
        #[oai(name = "code")] Query(code): Query<Option<String>>,
        #[oai(name = "state")] Query(state): Query<Option<String>>,
        #[oai(name = "error")] Query(error): Query<Option<String>>,
        session: &Session,
        Data(auth): Data<&AuthState>,
        Data(pool): Data<&DatabasePool>,
    ) -> poem::Result<Response<AuthRedirectResponse>> {
        oidc::finish_callback(code, state, error, session, auth, pool).await
    }

    /// 認証設定の公開情報を取得する
    #[oai(path = "/config", method = "get")]
    async fn get_config(&self, Data(auth): Data<&AuthState>) -> poem::Result<Json<AuthConfigInfo>> {
        Ok(Json(AuthConfigInfo {
            oidc_enabled: auth.oidc_enabled(),
            developer_auth_enabled: auth.developer_auth_enabled(),
        }))
    }

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
            user: user
                .map(|(id, user_id, username)| User {
                    id,
                    user_id,
                    username,
                })
                .into(),
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
        Data(auth): Data<&AuthState>,
        Data(pool): Data<&DatabasePool>,
    ) -> poem::Result<Json<SessionInfo>> {
        if !auth.developer_auth_enabled() {
            return Err(poem::Error::from_status(poem::http::StatusCode::NOT_FOUND));
        }
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
