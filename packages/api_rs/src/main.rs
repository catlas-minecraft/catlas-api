use catlas_api::{config::Config, database, modules::auth, openapi_service};
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
    let config = Config::from_env()?;
    let telemetry = telemetry::Telemetry::init(config.telemetry())?;
    let result = run(config).await;
    telemetry.shutdown();

    result
}

async fn run(config: Config) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let database_url = config.database_url().to_owned();
    let database =
        tokio::task::spawn_blocking(move || database::connect_and_migrate(database_url)).await??;
    let auth_state = auth::AuthState::from_config(config.auth()).await?;

    let api_service = openapi_service();

    // api_serviceをRouteに移動する前に生成する
    let swagger_ui = api_service.scalar();
    let spec_endpoint = api_service.spec_endpoint();

    let server_session = ServerSession::new(
        CookieConfig::default()
            .http_only(true)
            .secure(config.cookie_secure())
            .same_site(SameSite::Lax),
        MemoryStorage::new(),
    );

    let app = Route::new()
        .nest("/api", api_service)
        .at("/api/openapi.json", spec_endpoint)
        .nest("/docs", swagger_ui)
        .with(RequestTracing)
        .with(server_session)
        .data(config.clone())
        .data(database)
        .data(auth_state);

    let address = format!("{}:{}", config.host(), config.port());
    Server::new(TcpListener::bind(address)).run(app).await?;

    Ok(())
}
