pub mod database;
pub mod schema;
// Diesel's generated modules only declare same-schema relationships.  Keep
// cross-schema visibility here, rather than in a feature module, so every
// query sees the same deterministic set of table relationships.
pub mod schema_cross;
