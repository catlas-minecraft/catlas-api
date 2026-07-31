pub mod database;
pub mod modules;
pub mod schema;
pub mod tags;
// Diesel's generated modules only declare same-schema relationships.  Keep
// cross-schema visibility here, rather than in a feature module, so every
// query sees the same deterministic set of table relationships.
pub mod schema_cross;

use poem_openapi::OpenApiService;

pub fn openapi_service() -> OpenApiService<impl poem_openapi::OpenApi, ()> {
    OpenApiService::new(
        (
            modules::auth::AuthModule,
            modules::ChangesetsModule,
            modules::NodesModule,
            modules::WaysModule,
            modules::RelationsModule,
            modules::ViewportModule,
        ),
        "Catlas API",
        "1.0.0",
    )
    .server("/api")
}
