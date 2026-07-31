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

    use super::{MIGRATIONS, connect_and_migrate};
    use crate::modules::auth::provision_user;

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
            "INSERT INTO history.node_versions (node_id, version, snapshot, changeset_id)
             VALUES (9001, 1, '{\"createdBy\": \"legacy-user\", \"updatedBy\": \"legacy-user\"}', $1),
                    (9001, 2, '{\"createdBy\": \"legacy-user\"}', $1)",
        )
        .bind::<BigInt, _>(changeset.id)
        .execute(&mut connection)
        .expect("legacy history insert failed");
        drop(connection);

        let pool = connect_and_migrate(database_url.clone()).expect("first migration run failed");
        connect_and_migrate(database_url).expect("second migration run failed");

        let mut connection = pool.get().expect("database connection failed");
        let first = provision_user(&mut connection, "ProvisionedUser")
            .expect("first user provisioning failed");
        let same = provision_user(&mut connection, "ProvisionedUser")
            .expect("second user provisioning failed");
        let case_distinct = provision_user(&mut connection, "provisioneduser")
            .expect("case-distinct user provisioning failed");
        assert_eq!(first, same);
        assert_ne!(first.0, case_distinct.0);
        assert_eq!(case_distinct.1, "provisioneduser");
        let legacy_user_count = sql_query(
            "SELECT count(*)::bigint AS count FROM core.users WHERE username = 'legacy-user'",
        )
        .get_result::<Count>(&mut connection)
        .expect("legacy user query failed");
        assert_eq!(legacy_user_count.count, 1);
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

        assert_eq!(migration_count.count, expected_migration_count);
        assert_eq!(postgis_count.count, 1);
        assert_eq!(application_table_count.count, 19);
        assert_eq!(published_index_count.count, 1);
        assert_eq!(actor_fk_count.count, 10);
    }
}
