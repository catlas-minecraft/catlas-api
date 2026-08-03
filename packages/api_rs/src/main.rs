use catlas_api::{database, modules::auth, openapi_service};
use poem::{
    EndpointExt, Route, Server,
    listener::TcpListener,
    session::{CookieConfig, MemoryStorage, ServerSession},
    web::cookie::SameSite,
};

use crate::middleware::RequestTracing;
mod middleware;
mod telemetry;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dotenvy::dotenv().ok();
    let telemetry = telemetry::Telemetry::init()?;
    let result = run().await;
    telemetry.shutdown();

    result
}

async fn run() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let database_url = std::env::var("DATABASE_URL")?;
    let database =
        tokio::task::spawn_blocking(move || database::connect_and_migrate(database_url)).await??;
    let auth_state = auth::AuthState::from_env().await?;

    let api_service = openapi_service();

    // api_serviceをRouteに移動する前に生成する
    let swagger_ui = api_service.scalar();
    let spec_endpoint = api_service.spec_endpoint();

    let secure_cookie = std::env::var("COOKIE_SECURE")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let server_session = ServerSession::new(
        CookieConfig::default()
            .http_only(true)
            .secure(secure_cookie)
            .same_site(SameSite::Lax),
        MemoryStorage::new(),
    );

    let app = Route::new()
        .nest("/api", api_service)
        .at("/api/openapi.json", spec_endpoint)
        .nest("/docs", swagger_ui)
        .with(RequestTracing)
        .with(server_session)
        .data(database)
        .data(auth_state);

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_owned());
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_owned());
    let address = format!("{host}:{port}");
    Server::new(TcpListener::bind(address)).run(app).await?;

    Ok(())
}
