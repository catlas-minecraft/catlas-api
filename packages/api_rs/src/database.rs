use std::error::Error;

use diesel::{
    QueryableByName, RunQueryDsl,
    r2d2::{ConnectionManager, Pool},
    sql_query,
    sql_types::{BigInt, Bool},
};
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};
use diesel_tracing::pg::InstrumentedPgConnection;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");
const MIGRATION_LOCK_ID: i64 = 0x43_61_74_6c_61_73;

pub type DatabaseConnection = InstrumentedPgConnection;
pub type DatabasePool = Pool<ConnectionManager<DatabaseConnection>>;
pub type DatabaseError = Box<dyn Error + Send + Sync>;

/// Diesel is deliberately kept off the async executor.  All API database work
/// goes through this small helper so this rule cannot be accidentally missed.
pub async fn blocking<T, F>(pool: &DatabasePool, work: F) -> Result<T, DatabaseError>
where
    T: Send + 'static,
    F: FnOnce(&mut DatabaseConnection) -> Result<T, DatabaseError> + Send + 'static,
{
    let pool = pool.clone();
    let span = tracing::Span::current();
    tokio::task::spawn_blocking(move || {
        span.in_scope(|| {
            let mut connection = pool.get()?;
            work(&mut connection)
        })
    })
    .await
    .map_err(|error| std::io::Error::other(error.to_string()))?
}

#[derive(QueryableByName)]
struct AdvisoryLockResult {
    #[diesel(sql_type = Bool)]
    locked: bool,
}

pub fn connect_and_migrate(database_url: String) -> Result<DatabasePool, DatabaseError> {
    let manager = ConnectionManager::<DatabaseConnection>::new(database_url);
    let pool = Pool::builder()
        .max_size(10)
        .min_idle(Some(1))
        .test_on_check_out(true)
        .build(manager)?;

    let mut connection = pool.get()?;
    acquire_migration_lock(&mut connection)?;
    let migration_result = connection.run_pending_migrations(MIGRATIONS).map(drop);
    let unlock_result = release_migration_lock(&mut connection);
    migration_result?;
    unlock_result?;
    drop(connection);

    Ok(pool)
}

fn acquire_migration_lock(connection: &mut DatabaseConnection) -> Result<(), DatabaseError> {
    let result = sql_query("SELECT true AS locked FROM pg_advisory_lock($1)")
        .bind::<BigInt, _>(MIGRATION_LOCK_ID)
        .get_result::<AdvisoryLockResult>(connection)?;
    debug_assert!(result.locked);
    Ok(())
}

fn release_migration_lock(connection: &mut DatabaseConnection) -> Result<(), DatabaseError> {
    let result = sql_query("SELECT pg_advisory_unlock($1) AS locked")
        .bind::<BigInt, _>(MIGRATION_LOCK_ID)
        .get_result::<AdvisoryLockResult>(connection)?;

    if !result.locked {
        return Err(std::io::Error::other("migration advisory lock was not held").into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use diesel::{
        Connection, PgConnection, QueryableByName, RunQueryDsl,
        connection::SimpleConnection,
        migration::{Migration, MigrationSource},
        pg::Pg,
        sql_query,
        sql_types::{BigInt, Jsonb, Text},
    };
    use poem::{
        EndpointExt, Route,
        http::StatusCode,
        session::{CookieConfig, MemoryStorage, ServerSession},
        test::TestClient,
    };

    use super::{MIGRATIONS, connect_and_migrate};
    use crate::modules::auth::provision_user;
    use crate::modules::users::find_user;
    use crate::openapi_service;

    #[derive(QueryableByName)]
    struct Count {
        #[diesel(sql_type = BigInt)]
        count: i64,
    }

    #[derive(QueryableByName)]
    struct DatabaseName {
        #[diesel(sql_type = Text)]
        name: String,
    }

    #[derive(QueryableByName)]
    struct Id {
        #[diesel(sql_type = BigInt)]
        id: i64,
    }

    #[derive(QueryableByName)]
    struct UserRecord {
        #[diesel(sql_type = BigInt)]
        id: i64,
        #[diesel(sql_type = Text)]
        user_id: String,
        #[diesel(sql_type = Text)]
        username: String,
    }

    #[derive(QueryableByName)]
    struct Snapshot {
        #[diesel(sql_type = Jsonb)]
        snapshot: serde_json::Value,
    }

    #[test]
    #[ignore = "requires TEST_DATABASE_URL"]
    fn applies_migrations_idempotently() {
        let database_url =
            std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL must be set");
        let mut connection =
            PgConnection::establish(&database_url).expect("database connection failed");
        let database_name = sql_query("SELECT current_database() AS name")
            .get_result::<DatabaseName>(&mut connection)
            .expect("database name query failed");
        assert_eq!(
            database_name.name, "catlas_test",
            "TEST_DATABASE_URL must target the catlas_test database"
        );
        connection
            .batch_execute(
                "DROP SCHEMA IF EXISTS core CASCADE;
                 DROP SCHEMA IF EXISTS draft CASCADE;
                 DROP SCHEMA IF EXISTS derived CASCADE;
                 DROP SCHEMA IF EXISTS history CASCADE;
                 DROP TABLE IF EXISTS public.__diesel_schema_migrations;
                 DROP EXTENSION IF EXISTS postgis CASCADE;",
            )
            .expect("test database reset failed");
        let migrations = MigrationSource::<Pg>::migrations(&MIGRATIONS)
            .expect("embedded migrations could not be loaded");
        sql_query(
            "CREATE TABLE public.__diesel_schema_migrations (
               version VARCHAR(50) PRIMARY KEY,
               run_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
             )",
        )
        .execute(&mut connection)
        .expect("migration history table creation failed");
        migrations[0]
            .run(&mut connection)
            .expect("initial migration failed");
        sql_query(
            "INSERT INTO public.__diesel_schema_migrations (version, run_on)
             VALUES ('0001', CURRENT_TIMESTAMP)",
        )
        .execute(&mut connection)
        .expect("initial migration history insert failed");
        let changeset = sql_query(
            "INSERT INTO core.changesets (status, created_by) VALUES ('open', 'legacy-user') RETURNING id",
        )
        .get_result::<Id>(&mut connection)
        .expect("legacy changeset insert failed");
        sql_query(
            "INSERT INTO core.nodes (
               id, mc_x, mc_y, mc_z, feature_type, tags, created_changeset_id,
               created_by, updated_by, changeset_id
             ) VALUES (9001, 1, 2, 3, 'landmark', '{}', $1, 'legacy-user', 'legacy-user', $1)",
        )
        .bind::<BigInt, _>(changeset.id)
        .execute(&mut connection)
        .expect("legacy node insert failed");
        sql_query(
            "INSERT INTO core.ways (
               id, feature_type, geometry_kind, is_closed, tags, created_changeset_id,
               created_by, updated_by, changeset_id
             ) VALUES (9002, 'route', 'line', false, '{}', $1, 'legacy-user', 'legacy-user', $1)",
        )
        .bind::<BigInt, _>(changeset.id)
        .execute(&mut connection)
        .expect("legacy way insert failed");
        sql_query(
            "INSERT INTO draft.nodes (
               changeset_id, id, operation, mc_x, mc_y, mc_z, feature_type, tags, staged_by
             ) VALUES ($1, -1, 'create', 4, 5, 6, 'spawn', '{}', 'legacy-user')",
        )
        .bind::<BigInt, _>(changeset.id)
        .execute(&mut connection)
        .expect("legacy node draft insert failed");
        sql_query(
            "INSERT INTO draft.ways (
               changeset_id, id, operation, feature_type, geometry_kind, is_closed, tags, staged_by
             ) VALUES ($1, -2, 'create', 'boundary', 'line', false, '{}', 'legacy-user')",
        )
        .bind::<BigInt, _>(changeset.id)
        .execute(&mut connection)
        .expect("legacy feature type fixture insert failed");
        sql_query(
            "INSERT INTO history.node_versions (node_id, version, snapshot, changeset_id)
             VALUES (9001, 1, '{\"featureType\": \"landmark\", \"createdBy\": \"legacy-user\", \"updatedBy\": \"legacy-user\"}', $1),
                    (9001, 2, '{\"featureType\": \"spawn\", \"createdBy\": \"legacy-user\"}', $1)",
        )
        .bind::<BigInt, _>(changeset.id)
        .execute(&mut connection)
        .expect("legacy history insert failed");
        sql_query(
            "INSERT INTO history.way_versions (way_id, version, snapshot, changeset_id)
             VALUES (9002, 1, '{\"featureType\": \"route\", \"createdBy\": \"legacy-user\", \"updatedBy\": \"legacy-user\"}', $1)",
        )
        .bind::<BigInt, _>(changeset.id)
        .execute(&mut connection)
        .expect("legacy way history insert failed");
        drop(connection);

        let pool = connect_and_migrate(database_url.clone()).expect("first migration run failed");
        connect_and_migrate(database_url).expect("second migration run failed");

        let mut connection = pool.get().expect("database connection failed");
        let first = provision_user(&mut connection, "provisioned-user")
            .expect("first user provisioning failed");
        let same = provision_user(&mut connection, "provisioned-user")
            .expect("second user provisioning failed");
        assert_eq!(first, same);
        assert_eq!(first.1, "provisioned-user");
        assert_eq!(first.2, "provisioned-user");
        sql_query(
            "INSERT INTO core.users (user_id, username) VALUES ('named-user', 'Display Name')",
        )
        .execute(&mut connection)
        .expect("display-name user creation failed");
        let named = provision_user(&mut connection, "named-user")
            .expect("existing user provisioning failed");
        assert_eq!(named.2, "Display Name");
        let legacy_user = sql_query(
            "SELECT id, user_id, username FROM core.users WHERE username = 'legacy-user'",
        )
        .get_result::<UserRecord>(&mut connection)
        .expect("legacy user query failed");
        assert_eq!(legacy_user.user_id, format!("user_{}", legacy_user.id));
        assert_eq!(legacy_user.username, "legacy-user");
        assert_eq!(
            find_user(&mut connection, &legacy_user.user_id)
                .expect("public user lookup failed")
                .expect("legacy user was not found")
                .username,
            "legacy-user"
        );
        assert!(
            find_user(&mut connection, "missing-user")
                .expect("missing public user lookup failed")
                .is_none()
        );
        sql_query(
            "INSERT INTO core.users (user_id, username) VALUES ('another-user', 'legacy-user')",
        )
        .execute(&mut connection)
        .expect("user display names should not be unique");
        assert!(
            sql_query(
                "INSERT INTO core.users (user_id, username) VALUES ('Invalid-ID', 'invalid')",
            )
            .execute(&mut connection)
            .is_err()
        );

        let http_user = provision_user(&mut connection, "http-user")
            .expect("HTTP test user provisioning failed");
        tokio::runtime::Runtime::new()
            .expect("test runtime creation failed")
            .block_on(async {
                let app = Route::new()
                    .nest("/api", openapi_service())
                    .with(ServerSession::new(
                        CookieConfig::default(),
                        MemoryStorage::new(),
                    ))
                    .data(pool.clone());
                let client = TestClient::new(app);
                client
                    .post("/api/auth/session")
                    .body_json(&serde_json::json!({ "userId": " padded-user " }))
                    .send()
                    .await
                    .assert_status(StatusCode::BAD_REQUEST);
                client
                    .post("/api/auth/session")
                    .body_json(&serde_json::json!({ "userId": "http-user" }))
                    .send()
                    .await
                    .assert_json(serde_json::json!({
                        "user": {
                            "id": http_user.0,
                            "userId": http_user.1,
                            "username": http_user.2
                        }
                    }))
                    .await;
                client
                    .post("/api/auth/session")
                    .body_json(&serde_json::json!({
                        "userId": "valid-user",
                        "username": "legacy-field"
                    }))
                    .send()
                    .await
                    .assert_status(StatusCode::BAD_REQUEST);
                client
                    .get("/api/users/user_1")
                    .send()
                    .await
                    .assert_json(serde_json::json!({
                        "id": legacy_user.id,
                        "userId": legacy_user.user_id,
                        "username": "legacy-user"
                    }))
                    .await;
                client
                    .get("/api/users/missing-user")
                    .send()
                    .await
                    .assert_status(StatusCode::NOT_FOUND);
            });
        let snapshots = sql_query(
            "SELECT snapshot FROM history.node_versions WHERE node_id = 9001 ORDER BY version",
        )
        .load::<Snapshot>(&mut connection)
        .expect("legacy history query failed");
        assert_eq!(snapshots.len(), 2);
        assert_eq!(snapshots[0].snapshot["createdByUserId"], 1);
        assert_eq!(snapshots[0].snapshot["updatedByUserId"], 1);
        assert_eq!(snapshots[1].snapshot["createdByUserId"], 1);
        assert!(snapshots[1].snapshot.get("updatedBy").is_none());
        assert!(
            snapshots
                .iter()
                .all(|snapshot| snapshot.snapshot.get("featureType").is_none())
        );
        let way_snapshots = sql_query(
            "SELECT snapshot FROM history.way_versions WHERE way_id = 9002 ORDER BY version",
        )
        .load::<Snapshot>(&mut connection)
        .expect("legacy way history query failed");
        assert_eq!(way_snapshots.len(), 1);
        assert!(way_snapshots[0].snapshot.get("featureType").is_none());
        let feature_type_column_count = sql_query(
            "SELECT count(*)::bigint AS count
             FROM information_schema.columns
             WHERE table_schema IN ('core', 'draft')
               AND table_name IN ('nodes', 'ways')
               AND column_name = 'feature_type'",
        )
        .get_result::<Count>(&mut connection)
        .expect("feature type column query failed");
        let legacy_entity_count = sql_query(
            "SELECT (
               (SELECT count(*) FROM core.nodes WHERE id = 9001)
               + (SELECT count(*) FROM core.ways WHERE id = 9002)
               + (SELECT count(*) FROM draft.nodes WHERE id = -1)
               + (SELECT count(*) FROM draft.ways WHERE id = -2)
             )::bigint AS count",
        )
        .get_result::<Count>(&mut connection)
        .expect("legacy entity query failed");
        assert_eq!(feature_type_column_count.count, 0);
        assert_eq!(legacy_entity_count.count, 4);
        let expected_migration_count = MigrationSource::<Pg>::migrations(&MIGRATIONS)
            .expect("embedded migrations could not be loaded")
            .len() as i64;
        let migration_count = sql_query(
            "SELECT count(*)::bigint AS count \
             FROM public.__diesel_schema_migrations",
        )
        .get_result::<Count>(&mut connection)
        .expect("migration history query failed");
        let postgis_count = sql_query(
            "SELECT count(*)::bigint AS count FROM pg_extension WHERE extname = 'postgis'",
        )
        .get_result::<Count>(&mut connection)
        .expect("PostGIS extension query failed");
        let application_table_count = sql_query(
            "SELECT count(*)::bigint AS count
             FROM pg_tables
             WHERE (schemaname, tablename) IN (
               ('core', 'changesets'),
               ('core', 'worlds'),
               ('core', 'users'),
               ('core', 'nodes'),
               ('core', 'ways'),
               ('core', 'way_nodes'),
               ('core', 'relations'),
               ('core', 'relation_members'),
               ('derived', 'way_geometries'),
               ('derived', 'relation_geometries'),
               ('draft', 'nodes'),
               ('draft', 'ways'),
               ('draft', 'way_nodes'),
               ('draft', 'relations'),
               ('draft', 'relation_members'),
               ('history', 'node_versions'),
               ('history', 'way_versions'),
               ('history', 'way_node_versions'),
               ('history', 'relation_versions'),
               ('history', 'relation_member_versions')
             )",
        )
        .get_result::<Count>(&mut connection)
        .expect("application table query failed");
        let published_index_count = sql_query(
            "SELECT count(*)::bigint AS count
             FROM pg_indexes
             WHERE schemaname = 'core'
               AND indexname = 'changesets_published_id_desc_idx'",
        )
        .get_result::<Count>(&mut connection)
        .expect("published changeset index query failed");
        let actor_fk_count = sql_query(
            "SELECT count(*)::bigint AS count
             FROM pg_constraint
             WHERE contype = 'f' AND conname LIKE '%user_fk'",
        )
        .get_result::<Count>(&mut connection)
        .expect("actor foreign key query failed");
        let world_fk_count = sql_query(
            "SELECT count(*)::bigint AS count
             FROM pg_constraint
             WHERE contype = 'f' AND conname IN (
               'nodes_created_world_fk', 'nodes_current_world_fk',
               'ways_created_world_fk', 'ways_current_world_fk',
               'relations_created_world_fk', 'relations_current_world_fk',
               'way_nodes_way_world_fk', 'way_nodes_node_world_fk',
               'way_nodes_changeset_world_fk',
               'relation_members_relation_world_fk',
               'relation_members_changeset_world_fk'
             )",
        )
        .get_result::<Count>(&mut connection)
        .expect("world foreign key query failed");
        let world_index_count = sql_query(
            "SELECT count(*)::bigint AS count FROM pg_indexes
             WHERE schemaname = 'core' AND indexname = 'changesets_world_status_id_idx'",
        )
        .get_result::<Count>(&mut connection)
        .expect("world index query failed");

        assert_eq!(migration_count.count, expected_migration_count);
        assert_eq!(postgis_count.count, 1);
        assert_eq!(application_table_count.count, 20);
        assert_eq!(published_index_count.count, 1);
        assert_eq!(actor_fk_count.count, 11);
        assert_eq!(world_fk_count.count, 11);
        assert_eq!(world_index_count.count, 1);

        connection
            .batch_execute(
                "DELETE FROM draft.ways WHERE id = -2;
                 DELETE FROM draft.nodes WHERE id = -1;
                 DELETE FROM core.ways WHERE id = 9002;
                 DELETE FROM core.nodes WHERE id = 9001;",
            )
            .expect("legacy feature type fixture cleanup failed");
    }
}
