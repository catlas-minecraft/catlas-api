use super::models::{
    EntityState, NewDraftMember, NewDraftNode, NewDraftRelation, NewDraftWay, NewDraftWayNode,
};
use super::publication::publish_sync;
use super::queries::{expected_version, proposed_version};
use super::types::Point;
use super::validation::{validate_point, validate_tags, validate_way};
use super::viewport::{bbox_geometry, parse_bbox, viewport_typed};
use crate::{
    database,
    schema::{core, draft},
};
use diesel::{Connection, ExpressionMethods, RunQueryDsl, insert_into};
use postgis_diesel::types::Point as PostgisPoint;

#[test]
fn validates_way_topology() {
    assert!(validate_way("line", &[1, 2]).is_ok());
    assert!(validate_way("line", &[1]).is_err());
    assert!(validate_way("area", &[1, 2, 3, 1]).is_ok());
    assert!(validate_way("area", &[1, 2, 1, 1]).is_err());
    assert!(validate_way("area", &[1, 2, 3]).is_err());
}

#[test]
fn rejects_non_finite_points_and_reserved_tags() {
    assert!(
        validate_point(&Point {
            x: 0.0,
            y: f64::NAN,
            z: 1.0
        })
        .is_err()
    );
    let mut tags = std::collections::BTreeMap::new();
    tags.insert("version".to_owned(), "user-value".to_owned());
    assert!(validate_tags(&tags).is_err());
}

#[test]
fn rejects_malformed_or_inverted_bboxes() {
    assert_eq!(parse_bbox("0,1,2,3"), Some([0.0, 1.0, 2.0, 3.0]));
    assert!(parse_bbox("0,bad,2,3").is_none());
    assert!(parse_bbox("0,1,2").is_none());
    assert!(parse_bbox("2,1,0,3").is_none());
}

#[test]
fn bbox_is_an_srid_zero_xz_polygon() {
    let polygon = bbox_geometry([1.0, 2.0, 3.0, 4.0]);
    assert_eq!(polygon.srid, Some(0));
    assert_eq!(polygon.rings[0][0], PostgisPoint::new(1.0, 2.0, Some(0)));
    assert_eq!(polygon.rings[0][2], PostgisPoint::new(3.0, 4.0, Some(0)));
    assert_eq!(polygon.rings[0].first(), polygon.rings[0].last());
}

#[test]
fn distinguishes_required_and_proposed_versions() {
    let published = EntityState {
        operation: "core".into(),
        base_version: None,
        current_version: Some(4),
    };
    assert_eq!(expected_version(&published).unwrap(), 4);
    assert_eq!(proposed_version(&published).unwrap(), 5);

    let staged = EntityState {
        operation: "update".into(),
        base_version: Some(4),
        current_version: Some(4),
    };
    assert_eq!(expected_version(&staged).unwrap(), 5);
    assert_eq!(proposed_version(&staged).unwrap(), 5);
}

#[test]
#[ignore = "requires TEST_DATABASE_URL"]
fn publishes_and_queries_a_spatial_graph() {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL must be set");
    let pool = database::connect_and_migrate(database_url).expect("database setup failed");
    let mut connection = pool.get().expect("database connection failed");

    connection.test_transaction::<_, database::DatabaseError, _>(|connection| {
        let changeset_id = insert_into(core::changesets::table)
            .values((
                core::changesets::status.eq("open"),
                core::changesets::created_by.eq("integration-test"),
            ))
            .returning(core::changesets::id)
            .get_result::<i64>(connection)?;

        let mut node_ids = Vec::new();
        for (x, z) in [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)] {
            let node_id = diesel::select(diesel::dsl::sql::<diesel::sql_types::BigInt>(
                "nextval('core.node_id_seq'::regclass)",
            ))
            .get_result::<i64>(connection)?;
            insert_into(draft::nodes::table)
                .values(NewDraftNode {
                    changeset_id,
                    id: node_id,
                    operation: "create",
                    base_version: None,
                    mc_x: Some(x),
                    mc_y: Some(0.0),
                    mc_z: Some(z),
                    feature_type: Some("vertex"),
                    tags: Some(serde_json::json!({})),
                    staged_by: "integration-test",
                })
                .execute(connection)?;
            node_ids.push(node_id);
        }

        let way_id = diesel::select(diesel::dsl::sql::<diesel::sql_types::BigInt>(
            "nextval('core.way_id_seq'::regclass)",
        ))
        .get_result::<i64>(connection)?;
        insert_into(draft::ways::table)
            .values(NewDraftWay {
                changeset_id,
                id: way_id,
                operation: "create",
                base_version: None,
                feature_type: Some("building"),
                geometry_kind: Some("area"),
                is_closed: Some(true),
                tags: Some(serde_json::json!({})),
                staged_by: "integration-test",
            })
            .execute(connection)?;
        let ring = [
            node_ids[0],
            node_ids[1],
            node_ids[2],
            node_ids[3],
            node_ids[0],
        ];
        insert_into(draft::way_nodes::table)
            .values(
                ring.into_iter()
                    .enumerate()
                    .map(|(seq, node_id)| NewDraftWayNode {
                        changeset_id,
                        way_id,
                        seq: seq as i32,
                        node_id,
                    })
                    .collect::<Vec<_>>(),
            )
            .execute(connection)?;

        let relation_id = diesel::select(diesel::dsl::sql::<diesel::sql_types::BigInt>(
            "nextval('core.relation_id_seq'::regclass)",
        ))
        .get_result::<i64>(connection)?;
        insert_into(draft::relations::table)
            .values(NewDraftRelation {
                changeset_id,
                id: relation_id,
                operation: "create",
                base_version: None,
                relation_type: Some("multipolygon"),
                tags: Some(serde_json::json!({})),
                staged_by: "integration-test",
            })
            .execute(connection)?;
        insert_into(draft::relation_members::table)
            .values(NewDraftMember {
                changeset_id,
                relation_id,
                seq: 0,
                member_type: "way",
                member_id: way_id,
                role: Some("outer"),
            })
            .execute(connection)?;

        let published = publish_sync(connection, changeset_id, "integration-test")?;
        assert_eq!(published.status, "published");

        let viewport = viewport_typed(connection, [-1.0, -1.0, 11.0, 11.0], true)?;
        assert_eq!(viewport.nodes.len(), 4);
        assert_eq!(viewport.ways.len(), 1);
        assert_eq!(viewport.way_nodes.len(), 5);
        assert_eq!(viewport.relations.len(), 1);
        assert_eq!(viewport.relation_members.len(), 1);
        assert!(viewport.ways[0].deleted_at.is_null());
        assert_eq!(viewport.ways[0].changeset_id, changeset_id);

        Ok(())
    });
}
