use poem::{
    EndpointExt, Route, Server,
    listener::TcpListener,
    session::{CookieConfig, MemoryStorage, ServerSession},
};
use poem_openapi::OpenApiService;

use catlas_api::database;

use crate::middleware::RequestTracing;
use crate::modules::{auth::AuthModule, geospatial::GeospatialModule};

mod middleware;
mod modules;
mod tags;
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

    let apis = (AuthModule, GeospatialModule);

    let api_service =
        OpenApiService::new(apis, "Catlas API", "1.0.0").server("http://localhost:3000/api");

    // api_serviceをRouteに移動する前に生成する
    let swagger_ui = api_service.scalar();

    let server_session = ServerSession::new(
        CookieConfig::default().http_only(true).secure(false),
        MemoryStorage::new(),
    );

    let app = Route::new()
        .nest("/api", api_service)
        .nest("/docs", swagger_ui)
        .with(RequestTracing)
        .with(server_session)
        .data(database);

    Server::new(TcpListener::bind("127.0.0.1:3000"))
        .run(app)
        .await?;

    Ok(())
}
