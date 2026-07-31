use super::NodesModule;
use crate::modules::NoContent;
use crate::modules::common::models::IdRow;
use crate::modules::common::queries::lock_owned_changeset;
use crate::modules::common::queries::{
    create_node_typed, delete_node_typed, node_json, patch_node_typed,
};
use crate::modules::common::support::{db_error, session_user};
use crate::modules::common::types::{DeleteInput, IdVersion, NodeInput, NodePatch};
use crate::modules::common::validation::{tag_value, validate_point, validate_tags};
use crate::{
    database::{self, DatabasePool},
    schema::core,
    tags::CatlasTags,
};
use diesel::{Connection, ExpressionMethods, QueryDsl, RunQueryDsl};
use poem::{Result, session::Session, web::Data};
use poem_openapi::{OpenApi, param::Path, payload::Json};
use serde_json::Value;

#[OpenApi(prefix_path = "/", tag = CatlasTags::Entities)]
impl NodesModule {
    /// Nodeを取得する
    ///
    /// 指定したIDの公開済みかつ削除されていないNodeを返す。
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
                .first::<(
                    i64,
                    i32,
                    f64,
                    f64,
                    f64,
                    String,
                    crate::modules::common::models::DbJson,
                )>(c)
                .map_err(Into::into)
        })
        .await
        .map_err(db_error)?;
        Ok(Json(node_json(row)))
    }

    /// Nodeを作成する
    ///
    /// 認証中のユーザーが所有するopen状態のChangesetに、新しいNodeをDraftとして追加する。
    #[oai(path = "/nodes", method = "post")]
    async fn create_node(
        &self,
        Json(input): Json<NodeInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<IdVersion>> {
        let user = session_user(session, pool).await?;
        validate_point(&input.geom)?;
        validate_tags(&input.tags)?;
        let tags = tag_value(&input.tags)?;
        let r = database::blocking(pool, move |c| {
            c.transaction::<IdRow, database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, user)?;
                create_node_typed(c, input, tags, user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(r.into()))
    }

    /// Nodeを更新する
    ///
    /// expectedVersionを検証し、Nodeの座標、種別、タグを指定したChangesetのDraftに保存する。
    #[oai(path = "/nodes/:id", method = "patch")]
    async fn patch_node(
        &self,
        #[oai(name = "id")] Path(node_id): Path<i64>,
        Json(input): Json<NodePatch>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<IdVersion>> {
        let user = session_user(session, pool).await?;
        validate_point(&input.geom)?;
        validate_tags(&input.tags)?;
        let tags = tag_value(&input.tags)?;
        let r = database::blocking(pool, move |c| {
            c.transaction::<IdRow, database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, user)?;
                patch_node_typed(c, node_id, input, tags, user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(r.into()))
    }

    /// Nodeを削除する
    ///
    /// expectedVersionを検証し、指定したChangesetにNodeの削除をDraftとして保存する。
    #[oai(path = "/nodes/:id", method = "delete")]
    async fn delete_node(
        &self,
        #[oai(name = "id")] Path(node_id): Path<i64>,
        Json(input): Json<DeleteInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<NoContent> {
        let user = session_user(session, pool).await?;
        database::blocking(pool, move |c| {
            c.transaction::<(), database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, user)?;
                delete_node_typed(c, node_id, input, user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(NoContent::NoContent)
    }
}
