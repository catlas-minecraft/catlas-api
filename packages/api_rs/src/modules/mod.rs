pub mod auth;
pub mod changesets;
pub(crate) mod common;
pub mod nodes;
pub mod relations;
pub mod viewport;
pub mod ways;

#[cfg(test)]
mod tests;

pub use changesets::ChangesetsModule;
pub use common::types::{
    Changeset, ChangesetInput, DeleteInput, GeometryKind, IdVersion, NodeInput, NodePatch, Point,
    RelationInput, RelationMember, RelationPatch, User, Viewport, WayInput, WayPatch,
};
pub use nodes::NodesModule;
pub use relations::RelationsModule;
pub use viewport::ViewportModule;
pub use ways::WaysModule;

use std::borrow::Cow;

use poem_openapi::{
    ApiResponse,
    registry::{MetaSchema, MetaSchemaRef, Registry},
    types::{ParseError, ParseFromJSON, ParseResult, ToJSON, Type},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nullable<T>(pub Option<T>);

impl<T> Nullable<T> {
    pub const fn is_null(&self) -> bool {
        self.0.is_none()
    }
}

impl<T> From<Option<T>> for Nullable<T> {
    fn from(value: Option<T>) -> Self {
        Self(value)
    }
}

impl<T: Type> Type for Nullable<T> {
    const IS_REQUIRED: bool = true;

    type RawValueType = T::RawValueType;
    type RawElementValueType = T::RawElementValueType;

    fn name() -> Cow<'static, str> {
        format!("nullable_{}", T::name()).into()
    }

    fn schema_ref() -> MetaSchemaRef {
        T::schema_ref().merge(MetaSchema {
            nullable: true,
            ..MetaSchema::ANY
        })
    }

    fn register(registry: &mut Registry) {
        T::register(registry);
    }

    fn as_raw_value(&self) -> Option<&Self::RawValueType> {
        self.0.as_ref().and_then(Type::as_raw_value)
    }

    fn raw_element_iter<'a>(
        &'a self,
    ) -> Box<dyn Iterator<Item = &'a Self::RawElementValueType> + 'a> {
        match &self.0 {
            Some(value) => value.raw_element_iter(),
            None => Box::new(std::iter::empty()),
        }
    }
}

impl<T: ToJSON> ToJSON for Nullable<T> {
    fn to_json(&self) -> Option<serde_json::Value> {
        match &self.0 {
            Some(value) => value.to_json(),
            None => Some(serde_json::Value::Null),
        }
    }
}

impl<T: ParseFromJSON> ParseFromJSON for Nullable<T> {
    fn parse_from_json(value: Option<serde_json::Value>) -> ParseResult<Self> {
        match value {
            None => Err(ParseError::expected_input()),
            Some(serde_json::Value::Null) => Ok(Self(None)),
            Some(value) => T::parse_from_json(Some(value))
                .map(|value| Self(Some(value)))
                .map_err(ParseError::propagate),
        }
    }
}

#[derive(ApiResponse)]
pub enum NoContent {
    #[oai(status = 204)]
    NoContent,
}
