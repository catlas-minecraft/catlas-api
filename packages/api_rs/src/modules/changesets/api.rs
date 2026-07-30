use super::ChangesetsModule;
use super::publication::publish_sync;
use crate::modules::common::models::ChangesetRow;
use crate::modules::common::queries::lock_owned_changeset;
use crate::modules::common::support::{db_error, session_user};
use crate::modules::common::types::{Changeset, ChangesetInput};
use crate::modules::NoContent;
use crate::{
    database::{self, DatabasePool},
    schema::{core, draft},
    tags::CatlasTags,
};
use diesel::{Connection, ExpressionMethods, QueryDsl, RunQueryDsl, insert_into};
use poem::{Result, session::Session, web::Data};
use poem_openapi::{
    OpenApi,
    param::Path,
    payload::Json,
};

#[OpenApi(prefix_path = "/", tag = CatlasTags::Entities)]
impl ChangesetsModule {
    /// Changesetを作成する
    ///
    /// 認証中のユーザーを所有者として、編集内容を一時保存するopen状態のChangesetを作成する。
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
                    core::changesets::created_at,
                    core::changesets::published_at,
                ))
                .get_result::<(
                    i64,
                    String,
                    Option<String>,
                    String,
                    chrono::DateTime<chrono::Utc>,
                    Option<chrono::DateTime<chrono::Utc>>,
                )>(c)
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
                created_at: row.4,
                published_at: row.5,
            }
            .into(),
        ))
    }

    /// 公開済みのChangeset一覧を取得する
    ///
    /// published状態のChangesetをIDの降順で返す。
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
                    core::changesets::created_at,
                    core::changesets::published_at,
                ))
                .load::<(
                    i64,
                    String,
                    Option<String>,
                    String,
                    chrono::DateTime<chrono::Utc>,
                    Option<chrono::DateTime<chrono::Utc>>,
                )>(c)
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
                        created_at: row.4,
                        published_at: row.5,
                    }
                    .into()
                })
                .collect(),
        ))
    }

    /// Changesetを公開する
    ///
    /// 認証中のユーザーが所有するopen状態のChangesetを検証し、Draftの編集内容を一括で公開する。
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

    /// Changesetを破棄する
    ///
    /// 認証中のユーザーが所有するopen状態のChangesetからDraftを削除し、abandoned状態に変更する。
    #[oai(path = "/changesets/:id/abandon", method = "post", tag = CatlasTags::Changesets)]
    async fn abandon(
        &self,
        Path(id): Path<i64>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<NoContent> {
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
        Ok(NoContent::NoContent)
    }
}
