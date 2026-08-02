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
            modules::UsersModule,
            modules::WorldsModule,
        ),
        "Catlas API",
        "1.0.0",
    )
    .server("/api")
}

#[cfg(test)]
mod tests {
    use super::openapi_service;
    use serde_json::Value;

    #[test]
    fn user_lookup_openapi_contract() {
        let spec: Value = serde_json::from_str(openapi_service().spec().as_str()).unwrap();
        let user_path = &spec["paths"]["/users/{userId}"]["get"];
        assert!(user_path.is_object());
        assert_eq!(user_path["parameters"][0]["name"], "userId");
        assert!(user_path["responses"]["404"].is_object());
        assert!(spec["components"]["schemas"]["User"]["properties"]["userId"].is_object());
    }

    #[test]
    fn node_and_way_openapi_schemas_have_no_feature_type() {
        let spec: Value = serde_json::from_str(openapi_service().spec().as_str()).unwrap();

        for schema in [
            "NodeInput",
            "NodePatch",
            "ViewportNode",
            "ViewportWay",
            "WayInput",
            "WayPatch",
        ] {
            assert!(
                spec["components"]["schemas"][schema]["properties"]
                    .get("featureType")
                    .is_none(),
                "{schema} still exposes featureType"
            );
        }
    }
}
