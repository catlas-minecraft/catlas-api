use super::GeospatialModule;
use super::models::{ChangesetRow, DbJson, IdRow};
use super::publication::publish_sync;
use super::queries::{
    create_node_typed, create_relation_typed, create_way_typed, delete_node_typed,
    delete_relation_typed, delete_way_typed, lock_owned_changeset, node_json, patch_node_typed,
    patch_relation_typed, patch_way_typed, relation_json, way_json,
};
use super::types::{
    Changeset, ChangesetInput, DeleteInput, IdVersion, NodeInput, NodePatch, RelationInput,
    RelationPatch, Viewport, WayInput, WayPatch,
};
use super::validation::{tag_value, validate_members, validate_point, validate_tags, validate_way};
use super::viewport::{parse_bbox, viewport_typed};
use crate::{
    database::{self, DatabasePool},
    schema::{core, draft},
    tags::CatlasTags,
};
use diesel::{Connection, ExpressionMethods, QueryDsl, RunQueryDsl, insert_into};
use poem::{Result, session::Session, web::Data};
use poem_openapi::{
    OpenApi,
    param::{Path, Query},
    payload::{Json, Response as ApiResponse},
};
use serde_json::Value;

fn session_user(session: &Session) -> Result<String> {
    session
        .get("username")
        .ok_or_else(|| poem::Error::from_status(poem::http::StatusCode::UNAUTHORIZED))
}

fn db_error(error: database::DatabaseError) -> poem::Error {
    poem::Error::from_string(
        error.to_string(),
        poem::http::StatusCode::INTERNAL_SERVER_ERROR,
    )
}

#[OpenApi(prefix_path = "/", tag = CatlasTags::Entities)]
impl GeospatialModule {
    #[oai(path = "/changesets", method = "post", tag = CatlasTags::Changesets)]
    async fn create_changeset(
        &self,
        Json(input): Json<ChangesetInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<Changeset>> {
        let user = session_user(session)?;
        let comment = input.comment;
        let row = database::blocking(pool, move |c| {
            insert_into(core::changesets::table)
                .values((
                    core::changesets::status.eq("open"),
                    core::changesets::comment.eq(comment),
                    core::changesets::created_by.eq(user),
                ))
                .returning((
                    core::changesets::id,
                    core::changesets::status,
                    core::changesets::comment,
                    core::changesets::created_by,
                ))
                .get_result::<(i64, String, Option<String>, String)>(c)
                .map_err(Into::into)
        })
        .await
        .map_err(db_error)?;
        Ok(Json(
            ChangesetRow {
                id: row.0,
                status: row.1,
                comment: row.2,
                created_by: row.3,
            }
            .into(),
        ))
    }
    #[oai(path = "/changesets", method = "get", tag = CatlasTags::Changesets)]
    async fn list_changesets(
        &self,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<Vec<Changeset>>> {
        let rows = database::blocking(pool, |c| {
            core::changesets::table
                .filter(core::changesets::status.eq("published"))
                .order_by(core::changesets::id.desc())
                .select((
                    core::changesets::id,
                    core::changesets::status,
                    core::changesets::comment,
                    core::changesets::created_by,
                ))
                .load::<(i64, String, Option<String>, String)>(c)
                .map_err(Into::into)
        })
        .await
        .map_err(db_error)?;
        Ok(Json(
            rows.into_iter()
                .map(|row| {
                    ChangesetRow {
                        id: row.0,
                        status: row.1,
                        comment: row.2,
                        created_by: row.3,
                    }
                    .into()
                })
                .collect(),
        ))
    }
    #[oai(path = "/changesets/:id/publish", method = "post", tag = CatlasTags::Changesets)]
    async fn publish(
        &self,
        Path(id): Path<i64>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<Changeset>> {
        let user = session_user(session)?;
        let row = database::blocking(pool, move |c| {
            c.transaction::<ChangesetRow, database::DatabaseError, _>(|c| {
                publish_sync(c, id, &user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(row.into()))
    }
    #[oai(path = "/changesets/:id/abandon", method = "post", tag = CatlasTags::Changesets)]
    async fn abandon(
        &self,
        Path(id): Path<i64>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<ApiResponse<()>> {
        let user = session_user(session)?;
        database::blocking(pool, move |c| {
            c.transaction::<(), database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, id, &user)?;
                diesel::delete(draft::nodes::table.filter(draft::nodes::changeset_id.eq(id)))
                    .execute(c)?;
                diesel::delete(draft::ways::table.filter(draft::ways::changeset_id.eq(id)))
                    .execute(c)?;
                diesel::delete(
                    draft::relations::table.filter(draft::relations::changeset_id.eq(id)),
                )
                .execute(c)?;
                diesel::update(core::changesets::table.filter(core::changesets::id.eq(id)))
                    .set(core::changesets::status.eq("abandoned"))
                    .execute(c)?;
                Ok(())
            })
        })
        .await
        .map_err(db_error)?;
        Ok(ApiResponse::new(()).status(poem::http::StatusCode::NO_CONTENT))
    }

    #[oai(path = "/nodes/:id", method = "get")]
    async fn get_node(
        &self,
        Path(id): Path<i64>,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<Value>> {
        let row = database::blocking(pool, move |c| {
            core::nodes::table
                .filter(core::nodes::id.eq(id))
                .filter(core::nodes::deleted_at.is_null())
                .select((
                    core::nodes::id,
                    core::nodes::version,
                    core::nodes::mc_x,
                    core::nodes::mc_y,
                    core::nodes::mc_z,
                    core::nodes::feature_type,
                    core::nodes::tags,
                ))
                .first::<(i64, i32, f64, f64, f64, String, DbJson)>(c)
                .map_err(Into::into)
        })
        .await
        .map_err(db_error)?;
        Ok(Json(node_json(row)))
    }
    #[oai(path = "/ways/:id", method = "get")]
    async fn get_way(
        &self,
        Path(id): Path<i64>,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<Value>> {
        let row = database::blocking(pool, move |c| {
            let way = core::ways::table
                .filter(core::ways::id.eq(id))
                .filter(core::ways::deleted_at.is_null())
                .select((
                    core::ways::id,
                    core::ways::version,
                    core::ways::feature_type,
                    core::ways::geometry_kind,
                    core::ways::tags,
                ))
                .first::<(i64, i32, String, String, DbJson)>(c)?;
            let refs = core::way_nodes::table
                .filter(core::way_nodes::way_id.eq(id))
                .order_by(core::way_nodes::seq)
                .select(core::way_nodes::node_id)
                .load::<i64>(c)?;
            Ok::<_, database::DatabaseError>((way.0, way.1, way.2, way.3, way.4, refs))
        })
        .await
        .map_err(db_error)?;
        Ok(Json(way_json(row)))
    }
    #[oai(path = "/relations/:id", method = "get")]
    async fn get_relation(
        &self,
        Path(id): Path<i64>,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<Value>> {
        let row = database::blocking(pool, move |c| {
            core::relations::table
                .filter(core::relations::id.eq(id))
                .filter(core::relations::deleted_at.is_null())
                .select((
                    core::relations::id,
                    core::relations::version,
                    core::relations::relation_type,
                    core::relations::tags,
                ))
                .first::<(i64, i32, String, DbJson)>(c)
                .map_err(Into::into)
        })
        .await
        .map_err(db_error)?;
        Ok(Json(relation_json(row)))
    }

    #[oai(path = "/nodes", method = "post")]
    async fn create_node(
        &self,
        Json(input): Json<NodeInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<IdVersion>> {
        let user = session_user(session)?;
        validate_point(&input.geom)?;
        validate_tags(&input.tags)?;
        let tags = tag_value(&input.tags)?;
        let r = database::blocking(pool, move |c| {
            c.transaction::<IdRow, database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, &user)?;
                create_node_typed(c, input, tags, &user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(r.into()))
    }

    #[oai(path = "/nodes/:id", method = "patch")]
    async fn patch_node(
        &self,
        Path(node_id): Path<i64>,
        Json(input): Json<NodePatch>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<IdVersion>> {
        let user = session_user(session)?;
        validate_point(&input.geom)?;
        validate_tags(&input.tags)?;
        let tags = tag_value(&input.tags)?;
        let r = database::blocking(pool, move |c| {
            c.transaction::<IdRow, database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, &user)?;
                patch_node_typed(c, node_id, input, tags, &user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(r.into()))
    }
    #[oai(path = "/nodes/:id", method = "delete")]
    async fn delete_node(
        &self,
        Path(node_id): Path<i64>,
        Json(input): Json<DeleteInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<ApiResponse<()>> {
        let user = session_user(session)?;
        database::blocking(pool, move |c| {
            c.transaction::<(), database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, &user)?;
                delete_node_typed(c, node_id, input, &user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(ApiResponse::new(()).status(poem::http::StatusCode::NO_CONTENT))
    }

    #[oai(path = "/ways", method = "post")]
    async fn create_way(
        &self,
        Json(input): Json<WayInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<IdVersion>> {
        let user = session_user(session)?;
        validate_tags(&input.tags)?;
        validate_way(&input.geometry_kind, &input.node_refs)?;
        let r = database::blocking(pool, move |c| {
            c.transaction::<IdRow, database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, &user)?;
                create_way_typed(c, input, &user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(r.into()))
    }
    #[oai(path = "/ways/:id", method = "patch")]
    async fn patch_way(
        &self,
        Path(way_id): Path<i64>,
        Json(input): Json<WayPatch>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<IdVersion>> {
        let user = session_user(session)?;
        validate_tags(&input.tags)?;
        validate_way(&input.geometry_kind, &input.node_refs)?;
        let r = database::blocking(pool, move |c| {
            c.transaction::<IdRow, database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, &user)?;
                patch_way_typed(c, way_id, input, &user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(r.into()))
    }
    #[oai(path = "/ways/:id", method = "delete")]
    async fn delete_way(
        &self,
        Path(way_id): Path<i64>,
        Json(input): Json<DeleteInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<ApiResponse<()>> {
        let user = session_user(session)?;
        database::blocking(pool, move |c| {
            c.transaction::<(), database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, &user)?;
                delete_way_typed(c, way_id, input, &user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(ApiResponse::new(()).status(poem::http::StatusCode::NO_CONTENT))
    }

    #[oai(path = "/relations", method = "post")]
    async fn create_relation(
        &self,
        Json(input): Json<RelationInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<IdVersion>> {
        let user = session_user(session)?;
        if input.relation_type != "multipolygon" {
            return Err(poem::Error::from_status(
                poem::http::StatusCode::UNPROCESSABLE_ENTITY,
            ));
        }
        validate_tags(&input.tags)?;
        validate_members(&input.members)?;
        let r = database::blocking(pool, move |c| {
            c.transaction::<IdRow, database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, &user)?;
                create_relation_typed(c, input, &user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(r.into()))
    }
    #[oai(path = "/relations/:id", method = "patch")]
    async fn patch_relation(
        &self,
        Path(relation_id): Path<i64>,
        Json(input): Json<RelationPatch>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<IdVersion>> {
        let user = session_user(session)?;
        if input.relation_type != "multipolygon" {
            return Err(poem::Error::from_status(
                poem::http::StatusCode::UNPROCESSABLE_ENTITY,
            ));
        }
        validate_tags(&input.tags)?;
        validate_members(&input.members)?;
        let r = database::blocking(pool, move |c| {
            c.transaction::<IdRow, database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, &user)?;
                patch_relation_typed(c, relation_id, input, &user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(r.into()))
    }
    #[oai(path = "/relations/:id", method = "delete")]
    async fn delete_relation(
        &self,
        Path(relation_id): Path<i64>,
        Json(input): Json<DeleteInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<ApiResponse<()>> {
        let user = session_user(session)?;
        database::blocking(pool, move |c| {
            c.transaction::<(), database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, &user)?;
                delete_relation_typed(c, relation_id, input, &user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(ApiResponse::new(()).status(poem::http::StatusCode::NO_CONTENT))
    }

    #[oai(path = "/viewport", method = "get", tag = CatlasTags::Viewport)]
    async fn viewport(
        &self,
        #[oai(name = "bbox")] Query(bbox): Query<String>,
        #[oai(name = "includeRelations")] Query(include_relations): Query<Option<String>>,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<Viewport>> {
        let Some([minx, minz, maxx, maxz]) = parse_bbox(&bbox) else {
            return Err(poem::Error::from_status(
                poem::http::StatusCode::BAD_REQUEST,
            ));
        };
        let relations = match include_relations.as_deref() {
            None | Some("false") => false,
            Some("true") => true,
            Some(_) => {
                return Err(poem::Error::from_status(
                    poem::http::StatusCode::BAD_REQUEST,
                ));
            }
        };
        let viewport = database::blocking(pool, move |c| {
            c.build_transaction()
                .repeatable_read()
                .run(|c| viewport_typed(c, [minx, minz, maxx, maxz], relations))
        })
        .await
        .map_err(db_error)?;
        Ok(Json(viewport))
    }
}

impl From<ChangesetRow> for Changeset {
    fn from(r: ChangesetRow) -> Self {
        Self {
            id: r.id,
            status: r.status,
            comment: r.comment,
            created_by: r.created_by,
        }
    }
}
impl From<IdRow> for IdVersion {
    fn from(r: IdRow) -> Self {
        Self {
            id: r.id,
            version: r.version,
        }
    }
}
