use poem::session::Session;
use poem_openapi::{
    ApiRequest, Object, OpenApi,
    payload::{Json, PlainText},
};

use crate::tags::CatlasTags;

/// 新規セッションの内容
#[derive(Object)]
struct SessionInfo {
    username: String,
}

#[derive(ApiRequest)]
enum CreateSessionRequest {
    Json(Json<SessionInfo>),
}

pub struct AuthModule;

#[OpenApi(prefix_path = "/auth", tag = CatlasTags::Auth)]
impl AuthModule {
    /// セッションを取得する
    #[oai(path = "/session", method = "get")]
    async fn get_session(&self, session: &Session) -> PlainText<String> {
        let name = session.get::<String>("name");

        let message = match name {
            Some(name) => format!("Hello {}!", name),
            None => "Who are you".to_string(),
        };

        PlainText(message)
    }

    /// 新規セッションを発行する
    ///
    /// テスト用のセッションを発行する。
    #[oai(path = "/session", method = "post")]
    async fn create_session(
        &self,
        request: CreateSessionRequest,
        session: &Session,
    ) -> PlainText<String> {
        let CreateSessionRequest::Json(request) = request;

        session.set("name", &request.0.username);

        let message = format!("Hello {}!", request.0.username);

        PlainText(message)
    }
}
