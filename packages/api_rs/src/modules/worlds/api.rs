use super::{
    WorldsModule,
    models::{World, WorldInput},
};
use crate::modules::common::types::User;
use crate::{
    database::{self, DatabasePool},
    modules::common::support::{db_error, session_user},
    schema::core,
    tags::CatlasTags,
};
use diesel::{ExpressionMethods, JoinOnDsl, OptionalExtension, QueryDsl, RunQueryDsl, insert_into};
use poem::{Result, http::StatusCode, session::Session, web::Data};
use poem_openapi::{OpenApi, param::Path, payload::Json};

#[OpenApi(prefix_path = "/", tag = CatlasTags::Entities)]
impl WorldsModule {
    #[oai(path = "/worlds", method = "get")]
    async fn list_worlds(&self, Data(pool): Data<&DatabasePool>) -> Result<Json<Vec<World>>> {
        let rows = database::blocking(pool, |c| {
            core::worlds::table
                .inner_join(
                    core::users::table.on(core::users::id.eq(core::worlds::created_by_user_id)),
                )
                .order_by(core::worlds::id)
                .select((
                    core::worlds::id,
                    core::worlds::slug,
                    core::worlds::name,
                    core::worlds::created_by_user_id,
                    core::worlds::created_at,
                    core::users::id,
                    core::users::user_id,
                    core::users::username,
                ))
                .load::<(
                    i64,
                    String,
                    String,
                    i64,
                    chrono::DateTime<chrono::Utc>,
                    i64,
                    String,
                    String,
                )>(c)
                .map_err(Into::into)
        })
        .await
        .map_err(db_error)?;
        Ok(Json(rows.into_iter().map(world_from_row).collect()))
    }

    #[oai(path = "/worlds/:worldSlug", method = "get")]
    async fn get_world(
        &self,
        #[oai(name = "worldSlug")] Path(slug): Path<String>,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<World>> {
        let row = database::blocking(pool, move |c| world_query(c, &slug))
            .await
            .map_err(db_error)?;
        row.map(world_from_row)
            .map(Json)
            .ok_or_else(|| poem::Error::from_status(StatusCode::NOT_FOUND))
    }

    #[oai(path = "/worlds", method = "post")]
    async fn create_world(
        &self,
        Json(input): Json<WorldInput>,
        session: &Session,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<World>> {
        let user = session_user(session, pool).await?;
        let slug = input.slug;
        let name = input.name.trim().to_owned();
        if !valid_slug(&slug) || name.chars().count() == 0 || name.chars().count() > 128 {
            return Err(poem::Error::from_status(StatusCode::BAD_REQUEST));
        }
        let row = database::blocking(pool, move |c| {
            if world_query(c, &slug)?.is_some() {
                return Err(std::io::Error::other("world slug already exists").into());
            }
            let id = insert_into(core::worlds::table)
                .values((
                    core::worlds::slug.eq(slug),
                    core::worlds::name.eq(name),
                    core::worlds::created_by_user_id.eq(user),
                ))
                .returning(core::worlds::id)
                .get_result::<i64>(c)?;
            world_query_by_id(c, id)
        })
        .await
        .map_err(|error| {
            if error.to_string().contains("world slug already exists") {
                poem::Error::from_status(StatusCode::CONFLICT)
            } else {
                db_error(error)
            }
        })?;
        row.map(world_from_row)
            .map(Json)
            .ok_or_else(|| poem::Error::from_status(StatusCode::INTERNAL_SERVER_ERROR))
    }
}

fn valid_slug(value: &str) -> bool {
    let length = value.len();
    (1..=64).contains(&length)
        && value
            .as_bytes()
            .first()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && value
            .as_bytes()
            .last()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && value.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

type WorldRow = (
    i64,
    String,
    String,
    i64,
    chrono::DateTime<chrono::Utc>,
    i64,
    String,
    String,
);
fn world_query(
    c: &mut database::DatabaseConnection,
    slug: &str,
) -> Result<Option<WorldRow>, database::DatabaseError> {
    core::worlds::table
        .inner_join(core::users::table.on(core::users::id.eq(core::worlds::created_by_user_id)))
        .filter(core::worlds::slug.eq(slug))
        .select((
            core::worlds::id,
            core::worlds::slug,
            core::worlds::name,
            core::worlds::created_by_user_id,
            core::worlds::created_at,
            core::users::id,
            core::users::user_id,
            core::users::username,
        ))
        .first(c)
        .optional()
        .map_err(Into::into)
}
fn world_query_by_id(
    c: &mut database::DatabaseConnection,
    id: i64,
) -> Result<Option<WorldRow>, database::DatabaseError> {
    core::worlds::table
        .inner_join(core::users::table.on(core::users::id.eq(core::worlds::created_by_user_id)))
        .filter(core::worlds::id.eq(id))
        .select((
            core::worlds::id,
            core::worlds::slug,
            core::worlds::name,
            core::worlds::created_by_user_id,
            core::worlds::created_at,
            core::users::id,
            core::users::user_id,
            core::users::username,
        ))
        .first(c)
        .optional()
        .map_err(Into::into)
}
fn world_from_row(row: WorldRow) -> World {
    World {
        id: row.0,
        slug: row.1,
        name: row.2,
        created_at: row.4,
        created_by: User {
            id: row.5,
            user_id: row.6,
            username: row.7,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::valid_slug;

    #[test]
    fn validates_world_slugs() {
        assert!(valid_slug("alpha-1"));
        assert!(valid_slug("a"));
        assert!(!valid_slug(""));
        assert!(!valid_slug("-alpha"));
        assert!(!valid_slug("alpha-"));
        assert!(!valid_slug("alpha--beta"));
        assert!(!valid_slug("Alpha"));
        assert!(!valid_slug(&"a".repeat(65)));
    }
}
