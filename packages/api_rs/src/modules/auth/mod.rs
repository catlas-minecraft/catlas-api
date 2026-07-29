use poem::session::Session;
use poem_openapi::{Object, OpenApi, payload::Json};
use serde::Deserialize;

use crate::modules::{NoContent, Nullable};
use crate::tags::CatlasTags;

/// 新規セッションの内容
#[derive(Object)]
pub struct SessionInfo {
    pub username: Nullable<String>,
}

#[derive(Object, Deserialize)]
pub struct CreateSession {
    pub username: String,
}

pub struct AuthModule;

#[OpenApi(prefix_path = "/auth", tag = CatlasTags::Auth)]
impl AuthModule {
    /// セッションを取得する
    #[oai(path = "/session", method = "get")]
    async fn get_session(&self, session: &Session) -> Json<SessionInfo> {
        Json(SessionInfo {
            username: Nullable(session.get("username")),
        })
    }

    /// 新規セッションを発行する
    ///
    /// テスト用のセッションを発行する。
    #[oai(path = "/session", method = "post")]
    async fn create_session(
        &self,
        Json(request): Json<CreateSession>,
        session: &Session,
    ) -> poem::Result<Json<SessionInfo>> {
        let username = request.username.trim();
        if username.is_empty() || username.len() > 128 {
            return Err(poem::Error::from_status(
                poem::http::StatusCode::BAD_REQUEST,
            ));
        }
        session.renew();
        session.set("username", username.to_owned());
        Ok(Json(SessionInfo {
            username: Nullable(Some(username.to_owned())),
        }))
    }

    #[oai(path = "/session", method = "delete")]
    async fn delete_session(&self, session: &Session) -> poem::Result<NoContent> {
        session.purge();
        Ok(NoContent::NoContent)
    }
}
