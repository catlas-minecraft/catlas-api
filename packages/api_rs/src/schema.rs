// @generated automatically by Diesel CLI.

pub mod core {
    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        core.changesets (id) {
            id -> Int8,
            status -> Text,
            comment -> Nullable<Text>,
            created_at -> Timestamptz,
            published_at -> Nullable<Timestamptz>,
            created_by_user_id -> Int8,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

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
            deleted_at -> Nullable<Timestamptz>,
            changeset_id -> Int8,
            created_by_user_id -> Int8,
            updated_by_user_id -> Int8,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        core.relation_members (relation_id, seq) {
            relation_id -> Int8,
            member_type -> Text,
            member_id -> Int8,
            seq -> Int4,
            role -> Nullable<Text>,
            changeset_id -> Int8,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        core.relations (id) {
            id -> Int8,
            relation_type -> Text,
            tags -> Jsonb,
            version -> Int4,
            created_changeset_id -> Int8,
            created_at -> Timestamptz,
            updated_at -> Timestamptz,
            deleted_at -> Nullable<Timestamptz>,
            changeset_id -> Int8,
            created_by_user_id -> Int8,
            updated_by_user_id -> Int8,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        core.users (id) {
            id -> Int8,
            username -> Text,
            created_at -> Timestamptz,
            user_id -> Text,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        core.way_nodes (way_id, seq) {
            way_id -> Int8,
            seq -> Int4,
            node_id -> Int8,
            changeset_id -> Int8,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

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
            deleted_at -> Nullable<Timestamptz>,
            changeset_id -> Int8,
            created_by_user_id -> Int8,
            updated_by_user_id -> Int8,
        }
    }

    diesel::joinable!(changesets -> users (created_by_user_id));
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
        users,
        way_nodes,
        ways,
    );
}

pub mod draft {
    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        draft.nodes (changeset_id, id) {
            changeset_id -> Int8,
            id -> Int8,
            operation -> Text,
            base_version -> Nullable<Int4>,
            mc_x -> Nullable<Float8>,
            mc_y -> Nullable<Float8>,
            mc_z -> Nullable<Float8>,
            feature_type -> Nullable<Text>,
            tags -> Nullable<Jsonb>,
            staged_at -> Timestamptz,
            staged_by_user_id -> Int8,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        draft.relation_members (changeset_id, relation_id, seq) {
            changeset_id -> Int8,
            relation_id -> Int8,
            seq -> Int4,
            member_type -> Text,
            member_id -> Int8,
            role -> Nullable<Text>,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        draft.relations (changeset_id, id) {
            changeset_id -> Int8,
            id -> Int8,
            operation -> Text,
            base_version -> Nullable<Int4>,
            relation_type -> Nullable<Text>,
            tags -> Nullable<Jsonb>,
            staged_at -> Timestamptz,
            staged_by_user_id -> Int8,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        draft.way_nodes (changeset_id, way_id, seq) {
            changeset_id -> Int8,
            way_id -> Int8,
            seq -> Int4,
            node_id -> Int8,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        draft.ways (changeset_id, id) {
            changeset_id -> Int8,
            id -> Int8,
            operation -> Text,
            base_version -> Nullable<Int4>,
            feature_type -> Nullable<Text>,
            geometry_kind -> Nullable<Text>,
            is_closed -> Nullable<Bool>,
            tags -> Nullable<Jsonb>,
            staged_at -> Timestamptz,
            staged_by_user_id -> Int8,
        }
    }

    diesel::allow_tables_to_appear_in_same_query!(
        nodes,
        relation_members,
        relations,
        way_nodes,
        ways,
    );
}

pub mod derived {
    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

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
        use postgis_diesel::sql_types::Geometry;

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
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        history.node_versions (node_id, version) {
            node_id -> Int8,
            version -> Int4,
            snapshot -> Jsonb,
            changeset_id -> Int8,
            recorded_at -> Timestamptz,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        history.relation_member_versions (relation_id, parent_version, seq) {
            relation_id -> Int8,
            parent_version -> Int4,
            seq -> Int4,
            snapshot -> Jsonb,
            changeset_id -> Int8,
            recorded_at -> Timestamptz,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        history.relation_versions (relation_id, version) {
            relation_id -> Int8,
            version -> Int4,
            snapshot -> Jsonb,
            changeset_id -> Int8,
            recorded_at -> Timestamptz,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        history.way_node_versions (way_id, parent_version, seq) {
            way_id -> Int8,
            parent_version -> Int4,
            seq -> Int4,
            snapshot -> Jsonb,
            changeset_id -> Int8,
            recorded_at -> Timestamptz,
        }
    }

    diesel::table! {
        use diesel::sql_types::*;
        use postgis_diesel::sql_types::Geometry;

        history.way_versions (way_id, version) {
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
