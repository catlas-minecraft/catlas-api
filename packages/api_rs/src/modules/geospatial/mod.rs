//! Geospatial API persistence. Application tables are referenced through the
//! generated Diesel schema. Raw `sql_query` calls are limited to the
//! publication advisory lock and the two PostGIS aggregate CTEs that Diesel
//! 2.3 cannot represent.

mod api;
mod models;
mod publication;
mod queries;
#[cfg(test)]
mod tests;
mod types;
mod validation;
mod viewport;

#[allow(unused_imports)]
pub use types::{
    Changeset, ChangesetInput, DeleteInput, IdVersion, NodeInput, NodePatch, Point, RelationInput,
    RelationMember, RelationPatch, Viewport, WayInput, WayPatch,
};

pub struct GeospatialModule;
