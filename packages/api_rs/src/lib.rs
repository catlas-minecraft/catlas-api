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

#[cfg(test)]
mod tests {
    use super::openapi_service;
    use serde_json::Value;

    #[test]
    fn openapi_describes_editor_contract() {
        let spec: Value = serde_json::from_str(&openapi_service().spec()).unwrap();
        assert_eq!(spec["servers"][0]["url"], "/api");
        for path in ["/viewport", "/changesets", "/auth/session", "/nodes/{id}"] {
            assert!(spec["paths"][path].is_object(), "missing {path}");
        }
        let viewport = &spec["components"]["schemas"]["Viewport"];
        for field in ["nodes", "ways", "wayNodes", "relations", "relationMembers"] {
            assert!(viewport["properties"][field]["items"]["$ref"].is_string());
        }
        assert_ne!(viewport["properties"]["nodes"]["items"], "{}");
        assert_eq!(
            spec["paths"]["/viewport"]["get"]["parameters"]
                .as_array()
                .unwrap()
                .iter()
                .find(|parameter| parameter["name"] == "includeRelations")
                .unwrap()["schema"]["type"],
            "boolean"
        );
        let changeset = &spec["components"]["schemas"]["Changeset"];
        for field in ["createdAt", "publishedAt", "status"] {
            assert!(changeset["properties"][field].is_object());
        }
        assert_eq!(changeset["properties"]["createdAt"]["format"], "date-time");
        assert_eq!(
            changeset["properties"]["publishedAt"]["format"],
            "date-time"
        );
        assert_eq!(changeset["properties"]["publishedAt"]["nullable"], true);
        assert_eq!(changeset["properties"]["comment"]["nullable"], true);
        assert_eq!(
            spec["components"]["schemas"]["SessionInfo"]["properties"]["username"]["nullable"],
            true
        );
        assert_eq!(
            spec["components"]["schemas"]["ViewportNode"]["properties"]["deletedAt"]["nullable"],
            true
        );
        assert_eq!(
            spec["components"]["schemas"]["ChangesetStatus"]["enum"],
            serde_json::json!(["open", "published", "abandoned"])
        );
        assert!(spec["paths"]["/nodes/{id}"]["delete"]["responses"]["204"].is_object());
        for (path, method) in [
            ("/nodes/{id}", "patch"),
            ("/nodes/{id}", "delete"),
            ("/ways/{id}", "patch"),
            ("/ways/{id}", "delete"),
        ] {
            assert_eq!(spec["paths"][path][method]["parameters"][0]["name"], "id");
        }
    }
}
