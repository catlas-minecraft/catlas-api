// @generated automatically by Diesel CLI.

pub mod auth {
    diesel::table! {
        auth.sessions (id) {
            id -> Text,
            secret_hash -> Bytea,
            user_id -> Text,
            expires_at -> Timestamptz,
            next_verified_at -> Timestamptz,
            created_at -> Timestamptz,
        }
    }
}

pub mod core {
    pub mod sql_types {
        #[derive(diesel::sql_types::SqlType)]
        #[diesel(postgres_type(name = "geometry"))]
        pub struct Geometry;
    }

    diesel::table! {
        core.changesets (id) {
            id -> Int8,
            status -> Text,
            comment -> Nullable<Text>,
            created_by -> Text,
            created_at -> Timestamptz,
            published_at -> Nullable<Timestamptz>,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use super::sql_types::Geometry;

        core.nodes (id) {
            id -> Int8,
            mc_x -> Float8,
            mc_y -> Float8,
            mc_z -> Float8,
            geom_2d -> Nullable<Geometry>,
            feature_type -> Text,
            tags -> Jsonb,
            version -> Int4,
            created_changeset_id -> Int8,
            created_at -> Timestamptz,
            updated_at -> Timestamptz,
            created_by -> Text,
            updated_by -> Text,
            deleted_at -> Nullable<Timestamptz>,
            changeset_id -> Int8,
        }
    }

    diesel::table! {
        core.relation_members (id) {
            id -> Int8,
            relation_id -> Int8,
            member_type -> Text,
            member_id -> Int8,
            seq -> Int4,
            role -> Nullable<Text>,
            version -> Int4,
            changeset_id -> Int8,
        }
    }

    diesel::table! {
        core.relations (id) {
            id -> Int8,
            relation_type -> Text,
            tags -> Jsonb,
            version -> Int4,
            created_changeset_id -> Int8,
            created_at -> Timestamptz,
            updated_at -> Timestamptz,
            created_by -> Text,
            updated_by -> Text,
            deleted_at -> Nullable<Timestamptz>,
            changeset_id -> Int8,
        }
    }

    diesel::table! {
        core.way_nodes (id) {
            id -> Int8,
            way_id -> Int8,
            node_id -> Int8,
            seq -> Int4,
            version -> Int4,
            changeset_id -> Int8,
        }
    }

    diesel::table! {
        core.ways (id) {
            id -> Int8,
            feature_type -> Text,
            geometry_kind -> Text,
            is_closed -> Bool,
            tags -> Jsonb,
            version -> Int4,
            created_changeset_id -> Int8,
            created_at -> Timestamptz,
            updated_at -> Timestamptz,
            created_by -> Text,
            updated_by -> Text,
            deleted_at -> Nullable<Timestamptz>,
            changeset_id -> Int8,
        }
    }

    diesel::joinable!(relation_members -> changesets (changeset_id));
    diesel::joinable!(relation_members -> relations (relation_id));
    diesel::joinable!(way_nodes -> changesets (changeset_id));
    diesel::joinable!(way_nodes -> nodes (node_id));
    diesel::joinable!(way_nodes -> ways (way_id));

    diesel::allow_tables_to_appear_in_same_query!(
        changesets,
        nodes,
        relation_members,
        relations,
        way_nodes,
        ways,
    );
}

pub mod derived {
    pub mod sql_types {
        #[derive(diesel::sql_types::SqlType)]
        #[diesel(postgres_type(name = "geometry"))]
        pub struct Geometry;
    }

    diesel::table! {
        use diesel::sql_types::*;
        use super::sql_types::Geometry;

        derived.relation_geometries (relation_id) {
            relation_id -> Int8,
            geom -> Geometry,
            bbox -> Geometry,
            source_version -> Int4,
            refreshed_at -> Timestamptz,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use super::sql_types::Geometry;

        derived.way_geometries (way_id) {
            way_id -> Int8,
            geom -> Geometry,
            bbox -> Geometry,
            source_version -> Int4,
            refreshed_at -> Timestamptz,
        }
    }

    diesel::allow_tables_to_appear_in_same_query!(relation_geometries, way_geometries,);
}

pub mod history {
    diesel::table! {
        history.node_versions (id) {
            id -> Int8,
            node_id -> Int8,
            version -> Int4,
            snapshot -> Jsonb,
            changeset_id -> Int8,
            recorded_at -> Timestamptz,
        }
    }

    diesel::table! {
        history.relation_member_versions (id) {
            id -> Int8,
            relation_member_id -> Int8,
            version -> Int4,
            snapshot -> Jsonb,
            changeset_id -> Int8,
            recorded_at -> Timestamptz,
        }
    }

    diesel::table! {
        history.relation_versions (id) {
            id -> Int8,
            relation_id -> Int8,
            version -> Int4,
            snapshot -> Jsonb,
            changeset_id -> Int8,
            recorded_at -> Timestamptz,
        }
    }

    diesel::table! {
        history.way_node_versions (id) {
            id -> Int8,
            way_node_id -> Int8,
            version -> Int4,
            snapshot -> Jsonb,
            changeset_id -> Int8,
            recorded_at -> Timestamptz,
        }
    }

    diesel::table! {
        history.way_versions (id) {
            id -> Int8,
            way_id -> Int8,
            version -> Int4,
            snapshot -> Jsonb,
            changeset_id -> Int8,
            recorded_at -> Timestamptz,
        }
    }

    diesel::allow_tables_to_appear_in_same_query!(
        node_versions,
        relation_member_versions,
        relation_versions,
        way_node_versions,
        way_versions,
    );
}
