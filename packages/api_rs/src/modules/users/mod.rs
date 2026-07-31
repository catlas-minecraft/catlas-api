use crate::database::{self, DatabaseConnection, DatabaseError, DatabasePool};
use crate::modules::common::types::User;
use crate::schema::core;
use crate::tags::CatlasTags;
use diesel::{ExpressionMethods, OptionalExtension, QueryDsl, RunQueryDsl};
use poem::web::Data;
use poem_openapi::{ApiResponse, OpenApi, param::Path, payload::Json};

pub struct UsersModule;

pub(crate) fn find_user(
    connection: &mut DatabaseConnection,
    public_user_id: &str,
) -> Result<Option<User>, DatabaseError> {
    core::users::table
        .filter(core::users::user_id.eq(public_user_id))
        .select((core::users::id, core::users::user_id, core::users::username))
        .first::<(i64, String, String)>(connection)
        .optional()
        .map(|user| {
            user.map(|(id, user_id, username)| User {
                id,
                user_id,
                username,
            })
        })
        .map_err(Into::into)
}

#[derive(ApiResponse)]
enum UserLookupResponse {
    #[oai(status = 200)]
    Ok(Json<User>),
    #[oai(status = 404)]
    NotFound,
}

#[OpenApi(prefix_path = "/", tag = CatlasTags::Users)]
impl UsersModule {
    /// Look up a public user by user ID.
    #[oai(path = "/users/:userId", method = "get")]
    #[allow(non_snake_case)]
    async fn get_user(
        &self,
        Path(userId): Path<String>,
        Data(pool): Data<&DatabasePool>,
    ) -> poem::Result<UserLookupResponse> {
        let user = database::blocking(pool, move |c| find_user(c, &userId))
            .await
            .map_err(crate::modules::common::support::db_error)?;

        Ok(match user {
            Some(user) => UserLookupResponse::Ok(Json(user)),
            None => UserLookupResponse::NotFound,
        })
    }
}
