use super::ChangesetsModule;
use super::publication::publish_sync;
use super::upload::upload_sync;
use crate::modules::NoContent;
use crate::modules::common::models::ChangesetRow;
use crate::modules::common::queries::{lock_owned_changeset, lock_world_for_mutation};
use crate::modules::common::support::{db_error, resolve_world, session_user};
use crate::modules::common::types::{
    Changeset, ChangesetInput, ChangesetUploadDiffResult, ChangesetUploadRequest,
};
use crate::modules::common::validation::{
    validate_members, validate_point, validate_tags, validate_way,
};
use crate::{
    database::{self, DatabasePool},
    schema::{core, draft},
    tags::CatlasTags,
};
use diesel::{Connection, ExpressionMethods, QueryDsl, RunQueryDsl, insert_into};
use poem::{Result, session::Session, web::Data};
use poem_openapi::{OpenApi, param::Path, payload::Json};
use std::collections::HashSet;

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

    /// Changesetのentityを一括でDraftへ追加する
    ///
    /// create、modify、deleteを依存関係順に適用し、全操作を1つのトランザクションで実行する。
    /// createのidはクライアント側の一時IDとして扱い、レスポンスで永続IDとの対応を返す。
    #[oai(path = "/worlds/:worldSlug/changesets/:id/upload", method = "post", tag = CatlasTags::Changesets)]
    async fn upload(
        &self,
        #[oai(name = "worldSlug")] Path(world_slug): Path<String>,
        Path(id): Path<i64>,
        Json(input): Json<ChangesetUploadRequest>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<ChangesetUploadDiffResult>> {
        let user = session_user(session, pool).await?;
        let world_id = resolve_world(pool, world_slug).await?;
        validate_upload(&input)?;
        let result = database::blocking(pool, move |c| {
            c.transaction::<ChangesetUploadDiffResult, database::DatabaseError, _>(|c| {
                upload_sync(c, id, user, world_id, input)
            })
        })
        .await
        .map_err(db_error)?;
        Ok(Json(result))
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
                lock_world_for_mutation(c, world_id)?;
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

fn validate_upload(input: &ChangesetUploadRequest) -> Result<()> {
    validate_operation_ids(
        input
            .create
            .nodes
            .iter()
            .map(|entity| &entity.id)
            .chain(input.modify.nodes.iter().map(|entity| &entity.id))
            .chain(input.delete.nodes.iter().map(|entity| &entity.id)),
        false,
    )?;
    validate_operation_ids(
        input
            .create
            .ways
            .iter()
            .map(|entity| &entity.id)
            .chain(input.modify.ways.iter().map(|entity| &entity.id))
            .chain(input.delete.ways.iter().map(|entity| &entity.id)),
        false,
    )?;
    validate_operation_ids(
        input
            .create
            .relations
            .iter()
            .map(|entity| &entity.id)
            .chain(input.modify.relations.iter().map(|entity| &entity.id))
            .chain(input.delete.relations.iter().map(|entity| &entity.id)),
        false,
    )?;
    validate_operation_ids(input.create.nodes.iter().map(|entity| &entity.id), true)?;
    validate_operation_ids(input.create.ways.iter().map(|entity| &entity.id), true)?;
    validate_operation_ids(input.create.relations.iter().map(|entity| &entity.id), true)?;

    for node in &input.create.nodes {
        validate_point(&node.geom)?;
        validate_tags(&node.tags)?;
    }
    for node in &input.modify.nodes {
        validate_point(&node.geom)?;
        validate_tags(&node.tags)?;
    }
    for way in &input.create.ways {
        validate_tags(&way.tags)?;
        validate_way(way.geometry_kind.as_str(), &way.node_refs)?;
    }
    for way in &input.modify.ways {
        validate_tags(&way.tags)?;
        validate_way(way.geometry_kind.as_str(), &way.node_refs)?;
    }
    for relation in &input.create.relations {
        validate_relation(
            relation.relation_type.as_str(),
            &relation.members,
            &relation.tags,
        )?;
    }
    for relation in &input.modify.relations {
        validate_relation(
            relation.relation_type.as_str(),
            &relation.members,
            &relation.tags,
        )?;
    }
    Ok(())
}

fn validate_relation(
    relation_type: &str,
    members: &[crate::modules::common::types::RelationMember],
    tags: &std::collections::BTreeMap<String, String>,
) -> Result<()> {
    if relation_type != "multipolygon" {
        return Err(poem::Error::from_status(
            poem::http::StatusCode::UNPROCESSABLE_ENTITY,
        ));
    }
    validate_tags(tags)?;
    validate_members(members)
}

fn validate_operation_ids<'a>(ids: impl Iterator<Item = &'a i64>, local: bool) -> Result<()> {
    let mut seen = HashSet::new();
    for id in ids {
        if (local && *id >= 0) || !seen.insert(*id) {
            return Err(poem::Error::from_status(
                poem::http::StatusCode::BAD_REQUEST,
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_operation_ids;

    #[test]
    fn requires_negative_unique_create_ids() {
        let valid = [-1_i64, -2];
        let positive = [1_i64];
        let duplicate = [-1_i64, -1];

        assert!(validate_operation_ids(valid.iter(), true).is_ok());
        assert!(validate_operation_ids(positive.iter(), true).is_err());
        assert!(validate_operation_ids(duplicate.iter(), false).is_err());
    }
}
