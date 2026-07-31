use super::RelationsModule;
use crate::modules::NoContent;
use crate::modules::common::models::IdRow;
use crate::modules::common::queries::lock_owned_changeset;
use crate::modules::common::queries::{
    create_relation_typed, delete_relation_typed, patch_relation_typed, relation_json,
};
use crate::modules::common::support::{db_error, session_user};
use crate::modules::common::types::{DeleteInput, IdVersion, RelationInput, RelationPatch};
use crate::modules::common::validation::{validate_members, validate_tags};
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
impl RelationsModule {
    /// Relationを取得する
    ///
    /// 指定したIDの公開済みかつ削除されていないRelationを返す。メンバーはレスポンスに含まれない。
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
                .first::<(i64, i32, String, crate::modules::common::models::DbJson)>(c)
                .map_err(Into::into)
        })
        .await
        .map_err(db_error)?;
        Ok(Json(relation_json(row)))
    }

    /// Relationを作成する
    ///
    /// Wayメンバーを検証し、指定したChangesetに新しいmultipolygon RelationをDraftとして追加する。メンバーのroleにはouter、inner、または未指定を使用できる。
    #[oai(path = "/relations", method = "post")]
    async fn create_relation(
        &self,
        Json(input): Json<RelationInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<IdVersion>> {
        let user = session_user(session, pool).await?;
        if input.relation_type != "multipolygon" {
            return Err(poem::Error::from_status(
                poem::http::StatusCode::UNPROCESSABLE_ENTITY,
            ));
        }
        validate_tags(&input.tags)?;
        validate_members(&input.members)?;
        let r = database::blocking(pool, move |c| {
            c.transaction::<IdRow, database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, user)?;
                create_relation_typed(c, input, user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(r.into()))
    }

    /// Relationを更新する
    ///
    /// expectedVersionとWayメンバーを検証し、multipolygon Relationの内容を指定したChangesetのDraftに保存する。
    #[oai(path = "/relations/:id", method = "patch")]
    async fn patch_relation(
        &self,
        #[oai(name = "id")] Path(relation_id): Path<i64>,
        Json(input): Json<RelationPatch>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<IdVersion>> {
        let user = session_user(session, pool).await?;
        if input.relation_type != "multipolygon" {
            return Err(poem::Error::from_status(
                poem::http::StatusCode::UNPROCESSABLE_ENTITY,
            ));
        }
        validate_tags(&input.tags)?;
        validate_members(&input.members)?;
        let r = database::blocking(pool, move |c| {
            c.transaction::<IdRow, database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, user)?;
                patch_relation_typed(c, relation_id, input, user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(r.into()))
    }

    /// Relationを削除する
    ///
    /// expectedVersionを検証し、指定したChangesetにRelationの削除をDraftとして保存する。
    #[oai(path = "/relations/:id", method = "delete")]
    async fn delete_relation(
        &self,
        #[oai(name = "id")] Path(relation_id): Path<i64>,
        Json(input): Json<DeleteInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<NoContent> {
        let user = session_user(session, pool).await?;
        database::blocking(pool, move |c| {
            c.transaction::<(), database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, input.changeset_id, user)?;
                delete_relation_typed(c, relation_id, input, user)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(NoContent::NoContent)
    }
}
