use crate::database;
use crate::modules::common::queries::{
    create_node_typed, create_relation_typed, create_way_typed, delete_node_typed,
    delete_relation_typed, delete_way_typed, lock_owned_changeset, lock_world_for_mutation,
    patch_node_typed, patch_relation_typed, patch_way_typed,
};
use crate::modules::common::types::{
    DeleteInput, NodeInput, NodePatch, RelationInput, RelationMember, RelationPatch, WayInput,
    WayPatch,
};
use std::collections::HashMap;

use super::models::{ChangesetUploadDiffEntry, ChangesetUploadDiffResult, ChangesetUploadRequest};

pub(crate) fn upload_sync(
    c: &mut database::DatabaseConnection,
    changeset_id: i64,
    user: i64,
    world_id: i64,
    input: ChangesetUploadRequest,
) -> Result<ChangesetUploadDiffResult, database::DatabaseError> {
    lock_world_for_mutation(c, world_id)?;
    lock_owned_changeset(c, changeset_id, user, world_id)?;

    let mut node_ids = HashMap::new();
    let mut way_ids = HashMap::new();
    let mut relation_ids = HashMap::new();
    let mut node_results = Vec::new();
    let mut way_results = Vec::new();
    let mut relation_results = Vec::new();

    for node in input.create.nodes {
        let old_id = node.id;
        let tags = serde_json::to_value(&node.tags)?;
        let created = create_node_typed(
            c,
            NodeInput {
                changeset_id,
                geom: node.geom,
                tags: node.tags,
            },
            tags,
            user,
        )?;
        node_ids.insert(old_id, created.id);
        node_results.push(diff_entry(old_id, created.id, created.version));
    }

    for way in input.create.ways {
        let old_id = way.id;
        let node_refs = way
            .node_refs
            .into_iter()
            .map(|id| resolve_id(id, &node_ids))
            .collect();
        let created = create_way_typed(
            c,
            WayInput {
                changeset_id,
                geometry_kind: way.geometry_kind,
                node_refs,
                tags: way.tags,
            },
            user,
            world_id,
        )?;
        way_ids.insert(old_id, created.id);
        way_results.push(diff_entry(old_id, created.id, created.version));
    }

    for relation in input.create.relations {
        let old_id = relation.id;
        let members = relation
            .members
            .into_iter()
            .map(|member| resolve_member(member, &node_ids, &way_ids, &relation_ids))
            .collect();
        let created = create_relation_typed(
            c,
            RelationInput {
                changeset_id,
                relation_type: relation.relation_type,
                members,
                tags: relation.tags,
            },
            user,
            world_id,
        )?;
        relation_ids.insert(old_id, created.id);
        relation_results.push(diff_entry(old_id, created.id, created.version));
    }

    for node in input.modify.nodes {
        let tags = serde_json::to_value(&node.tags)?;
        let updated = patch_node_typed(
            c,
            node.id,
            NodePatch {
                changeset_id,
                expected_version: node.expected_version,
                geom: node.geom,
                tags: node.tags,
            },
            tags,
            user,
            world_id,
        )?;
        node_results.push(diff_entry(node.id, updated.id, updated.version));
    }

    for way in input.modify.ways {
        let node_refs = way
            .node_refs
            .into_iter()
            .map(|id| resolve_id(id, &node_ids))
            .collect();
        let updated = patch_way_typed(
            c,
            way.id,
            WayPatch {
                changeset_id,
                expected_version: way.expected_version,
                geometry_kind: way.geometry_kind,
                node_refs,
                tags: way.tags,
            },
            user,
            world_id,
        )?;
        way_results.push(diff_entry(way.id, updated.id, updated.version));
    }

    for relation in input.modify.relations {
        let members = relation
            .members
            .into_iter()
            .map(|member| resolve_member(member, &node_ids, &way_ids, &relation_ids))
            .collect();
        let updated = patch_relation_typed(
            c,
            relation.id,
            RelationPatch {
                changeset_id,
                expected_version: relation.expected_version,
                relation_type: relation.relation_type,
                members,
                tags: relation.tags,
            },
            user,
            world_id,
        )?;
        relation_results.push(diff_entry(relation.id, updated.id, updated.version));
    }

    for relation in input.delete.relations {
        delete_relation_typed(
            c,
            relation.id,
            DeleteInput {
                changeset_id,
                expected_version: relation.expected_version,
            },
            user,
            world_id,
        )?;
    }

    for way in input.delete.ways {
        delete_way_typed(
            c,
            way.id,
            DeleteInput {
                changeset_id,
                expected_version: way.expected_version,
            },
            user,
            world_id,
        )?;
    }

    for node in input.delete.nodes {
        delete_node_typed(
            c,
            node.id,
            DeleteInput {
                changeset_id,
                expected_version: node.expected_version,
            },
            user,
            world_id,
        )?;
    }

    Ok(ChangesetUploadDiffResult {
        nodes: node_results,
        ways: way_results,
        relations: relation_results,
    })
}

fn diff_entry(old_id: i64, new_id: i64, new_version: i32) -> ChangesetUploadDiffEntry {
    ChangesetUploadDiffEntry {
        old_id,
        new_id,
        new_version,
    }
}

fn resolve_id(id: i64, ids: &HashMap<i64, i64>) -> i64 {
    ids.get(&id).copied().unwrap_or(id)
}

fn resolve_member(
    member: RelationMember,
    node_ids: &HashMap<i64, i64>,
    way_ids: &HashMap<i64, i64>,
    relation_ids: &HashMap<i64, i64>,
) -> RelationMember {
    let member_id = match member.member_type.as_str() {
        "node" => resolve_id(member.member_id, node_ids),
        "way" => resolve_id(member.member_id, way_ids),
        "relation" => resolve_id(member.member_id, relation_ids),
        _ => member.member_id,
    };
    RelationMember {
        member_type: member.member_type,
        member_id,
        role: member.role,
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_id, resolve_member};
    use crate::modules::common::types::RelationMember;
    use std::collections::HashMap;

    #[test]
    fn resolves_local_entity_ids_by_type() {
        let mut ids = HashMap::new();
        ids.insert(-1, 42);
        assert_eq!(resolve_id(-1, &ids), 42);
        assert_eq!(resolve_id(7, &ids), 7);
    }

    #[test]
    fn resolves_relation_member_ids_using_their_entity_type() {
        let node_ids = HashMap::from([(-1, 11)]);
        let way_ids = HashMap::from([(-1, 22)]);
        let relation_ids = HashMap::from([(-1, 33)]);

        assert_eq!(
            resolve_member(
                RelationMember {
                    member_type: "node".into(),
                    member_id: -1,
                    role: None,
                },
                &node_ids,
                &way_ids,
                &relation_ids,
            )
            .member_id,
            11
        );
        assert_eq!(
            resolve_member(
                RelationMember {
                    member_type: "way".into(),
                    member_id: -1,
                    role: Some("outer".into()),
                },
                &node_ids,
                &way_ids,
                &relation_ids,
            )
            .member_id,
            22
        );
    }
}
