use super::ChangesetsModule;
use super::publication::publish_sync;
use crate::modules::NoContent;
use crate::modules::common::models::ChangesetRow;
use crate::modules::common::queries::lock_owned_changeset;
use crate::modules::common::support::{db_error, resolve_world, session_user};
use crate::modules::common::types::{Changeset, ChangesetInput};
use crate::{
    database::{self, DatabasePool},
    schema::{core, draft},
    tags::CatlasTags,
};
use diesel::{Connection, ExpressionMethods, QueryDsl, RunQueryDsl, insert_into};
use poem::{Result, session::Session, web::Data};
use poem_openapi::{OpenApi, param::Path, payload::Json};

#[OpenApi(prefix_path = "/", tag = CatlasTags::Entities)]
impl ChangesetsModule {
    /// Changesetを作成する
    ///
    /// 認証中のユーザーを所有者として、編集内容を一時保存するopen状態のChangesetを作成する。
    #[oai(path = "/worlds/:worldSlug/changesets", method = "post", tag = CatlasTags::Changesets)]
    async fn create_changeset(
        &self,
        #[oai(name = "worldSlug")] Path(world_slug): Path<String>,
        Json(input): Json<ChangesetInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<Changeset>> {
        let user = session_user(session, pool).await?;
        let world_id = resolve_world(pool, world_slug).await?;
        let comment = input.comment;
        let row = database::blocking(pool, move |c| {
            c.transaction::<ChangesetRow, database::DatabaseError, _>(|c| {
                let row = insert_into(core::changesets::table)
                    .values((
                        core::changesets::status.eq("open"),
                        core::changesets::comment.eq(comment),
                        core::changesets::created_by_user_id.eq(user),
                        core::changesets::world_id.eq(world_id),
                    ))
                    .returning((
                        core::changesets::id,
                        core::changesets::status,
                        core::changesets::comment,
                        core::changesets::created_by_user_id,
                        core::changesets::created_at,
                        core::changesets::published_at,
                    ))
                    .get_result::<(
                        i64,
                        String,
                        Option<String>,
                        i64,
                        chrono::DateTime<chrono::Utc>,
                        Option<chrono::DateTime<chrono::Utc>>,
                    )>(c)?;
                let user = core::users::table
                    .filter(core::users::id.eq(row.3))
                    .select((core::users::user_id, core::users::username))
                    .first::<(String, String)>(c)?;
                Ok(ChangesetRow {
                    id: row.0,
                    status: row.1,
                    comment: row.2,
                    created_by_user_id: row.3,
                    created_by_user_id_public: user.0,
                    created_by_username: user.1,
                    created_at: row.4,
                    published_at: row.5,
                })
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(row.into()))
    }

    /// 公開済みのChangeset一覧を取得する
    ///
    /// published状態のChangesetをIDの降順で返す。
    #[oai(path = "/worlds/:worldSlug/changesets", method = "get", tag = CatlasTags::Changesets)]
    async fn list_changesets(
        &self,
        #[oai(name = "worldSlug")] Path(world_slug): Path<String>,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<Vec<Changeset>>> {
        let world_id = resolve_world(pool, world_slug).await?;
        let rows = database::blocking(pool, move |c| {
            core::changesets::table
                .filter(core::changesets::status.eq("published"))
                .filter(core::changesets::world_id.eq(world_id))
                .order_by(core::changesets::id.desc())
                .select((
                    core::changesets::id,
                    core::changesets::status,
                    core::changesets::comment,
                    core::changesets::created_by_user_id,
                    core::changesets::created_at,
                    core::changesets::published_at,
                ))
                .load::<(
                    i64,
                    String,
                    Option<String>,
                    i64,
                    chrono::DateTime<chrono::Utc>,
                    Option<chrono::DateTime<chrono::Utc>>,
                )>(c)
                .map_err(Into::into)
        })
        .await
        .map_err(db_error)?;
        let user_ids: Vec<i64> = rows.iter().map(|row| row.3).collect();
        let users = database::blocking(pool, move |c| {
            core::users::table
                .filter(core::users::id.eq_any(user_ids))
                .select((core::users::id, core::users::user_id, core::users::username))
                .load::<(i64, String, String)>(c)
                .map_err(Into::into)
        })
        .await
        .map_err(db_error)?;
        let users: std::collections::HashMap<_, _> = users
            .into_iter()
            .map(|(id, user_id, username)| (id, (user_id, username)))
            .collect();
        Ok(Json(
            rows.into_iter()
                .filter_map(|row| {
                    users.get(&row.3).map(|(user_id, username)| {
                        ChangesetRow {
                            id: row.0,
                            status: row.1,
                            comment: row.2,
                            created_by_user_id: row.3,
                            created_by_user_id_public: user_id.clone(),
                            created_by_username: username.clone(),
                            created_at: row.4,
                            published_at: row.5,
                        }
                        .into()
                    })
                })
                .collect(),
        ))
    }

    /// Changesetを公開する
    ///
    /// 認証中のユーザーが所有するopen状態のChangesetを検証し、Draftの編集内容を一括で公開する。
    #[oai(path = "/worlds/:worldSlug/changesets/:id/publish", method = "post", tag = CatlasTags::Changesets)]
    async fn publish(
        &self,
        #[oai(name = "worldSlug")] Path(world_slug): Path<String>,
        Path(id): Path<i64>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<Changeset>> {
        let user = session_user(session, pool).await?;
        let world_id = resolve_world(pool, world_slug).await?;
        let row = database::blocking(pool, move |c| {
            c.transaction::<ChangesetRow, database::DatabaseError, _>(|c| {
                publish_sync(c, id, user, world_id)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(row.into()))
    }

    /// Changesetを破棄する
    ///
    /// 認証中のユーザーが所有するopen状態のChangesetからDraftを削除し、abandoned状態に変更する。
    #[oai(path = "/worlds/:worldSlug/changesets/:id/abandon", method = "post", tag = CatlasTags::Changesets)]
    async fn abandon(
        &self,
        #[oai(name = "worldSlug")] Path(world_slug): Path<String>,
        Path(id): Path<i64>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<NoContent> {
        let user = session_user(session, pool).await?;
        let world_id = resolve_world(pool, world_slug).await?;
        database::blocking(pool, move |c| {
            c.transaction::<(), database::DatabaseError, _>(|c| {
                lock_owned_changeset(c, id, user, world_id)?;
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
