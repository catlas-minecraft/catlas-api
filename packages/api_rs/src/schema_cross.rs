//! Cross-schema Diesel table declarations.  Keep these in the library crate so
//! binaries and feature modules compile queries against the same schema graph.
use crate::schema::{core, derived, draft};
use core::{
    changesets as core_changesets, nodes as core_nodes, relation_members as core_relation_members,
    relations as core_relations, way_nodes as core_way_nodes, ways as core_ways,
};
use derived::{
    relation_geometries as derived_relation_geometries, way_geometries as derived_way_geometries,
};
use draft::{
    nodes as draft_nodes, relation_members as draft_relation_members, relations as draft_relations,
    way_nodes as draft_way_nodes, ways as draft_ways,
};

macro_rules! cross_schema {
    ($left:ident, $right:ident) => {
        diesel::allow_tables_to_appear_in_same_query!($left, $right);
    };
}

cross_schema!(core_changesets, draft_nodes);
cross_schema!(core_changesets, draft_ways);
cross_schema!(core_changesets, draft_relations);
cross_schema!(core_nodes, draft_nodes);
cross_schema!(core_ways, draft_ways);
cross_schema!(core_relations, draft_relations);
cross_schema!(core_way_nodes, draft_way_nodes);
cross_schema!(core_relation_members, draft_relation_members);
cross_schema!(core_ways, derived_way_geometries);
cross_schema!(core_relations, derived_relation_geometries);
