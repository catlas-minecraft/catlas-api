use super::WaysModule;
use crate::modules::NoContent;
use crate::modules::common::models::IdRow;
use crate::modules::common::queries::{
    create_way_typed, delete_way_typed, patch_way_typed, way_json,
};
use crate::modules::common::queries::lock_owned_changeset;
use crate::modules::common::support::{db_error, session_user};
use crate::modules::common::types::{DeleteInput, IdVersion, WayInput, WayPatch};
use crate::modules::common::validation::{validate_tags, validate_way};
use crate::{database::{self, DatabasePool}, schema::core, tags::CatlasTags};
use diesel::{Connection, ExpressionMethods, QueryDsl, RunQueryDsl};
use poem::{Result, session::Session, web::Data};
use poem_openapi::{OpenApi, param::Path, payload::Json};
use serde_json::Value;

#[OpenApi(prefix_path = "/", tag = CatlasTags::Entities)]
impl WaysModule {
    /// Wayを取得する
    ///
    /// 指定したIDの公開済みかつ削除されていないWayを、順序付けされたNode参照とともに返す。
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
                .first::<(i64, i32, String, String, crate::modules::common::models::DbJson)>(c)?;
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

    /// Wayを作成する
    ///
    /// Node参照とgeometryKindを検証し、指定したChangesetに新しいWayをDraftとして追加する。geometryKindはlineまたはareaを指定する。
    #[oai(path = "/ways", method = "post")]
    async fn create_way(
        &self,
        Json(input): Json<WayInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<IdVersion>> {
        let user = session_user(session)?;
        validate_tags(&input.tags)?;
        validate_way(input.geometry_kind.as_str(), &input.node_refs)?;
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

    /// Wayを更新する
    ///
    /// expectedVersion、Node参照、geometryKindを検証し、Wayの内容を指定したChangesetのDraftに保存する。
    #[oai(path = "/ways/:id", method = "patch")]
    async fn patch_way(
        &self,
        #[oai(name = "id")] Path(way_id): Path<i64>,
        Json(input): Json<WayPatch>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<IdVersion>> {
        let user = session_user(session)?;
        validate_tags(&input.tags)?;
        validate_way(input.geometry_kind.as_str(), &input.node_refs)?;
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

    /// Wayを削除する
    ///
    /// expectedVersionを検証し、指定したChangesetにWayの削除をDraftとして保存する。
    #[oai(path = "/ways/:id", method = "delete")]
    async fn delete_way(
        &self,
        #[oai(name = "id")] Path(way_id): Path<i64>,
        Json(input): Json<DeleteInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<NoContent> {
        let user = session_user(session)?;
        database::blocking(pool, move |c| {
            c.transaction::<(), database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, &user)?;
                delete_way_typed(c, way_id, input, &user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(NoContent::NoContent)
    }
}
