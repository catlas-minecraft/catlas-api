use super::{ViewportModule, models::Viewport};
use crate::modules::common::support::db_error;
use crate::{database, database::DatabasePool, tags::CatlasTags};
use poem::{Result, web::Data};
use poem_openapi::{OpenApi, param::Query, payload::Json};

use super::queries::{parse_bbox, viewport_typed};

#[OpenApi(prefix_path = "/", tag = CatlasTags::Entities)]
impl ViewportModule {
    /// Viewport内の地物を取得する
    ///
    /// bboxに`minX,minZ,maxX,maxZ`を指定し、範囲内のNodeとWay、およびWayが参照するNodeを返す。includeRelationsがtrueの場合は、範囲と交差するRelationとそのメンバーも含める。
    #[oai(path = "/viewport", method = "get", tag = CatlasTags::Viewport)]
    async fn viewport(
        &self,
        #[oai(name = "bbox")] Query(bbox): Query<String>,
        #[oai(name = "includeRelations")] Query(include_relations): Query<Option<bool>>,
        Data(pool): Data<&DatabasePool>,
    ) -> Result<Json<Viewport>> {
        let Some([minx, minz, maxx, maxz]) = parse_bbox(&bbox) else {
            return Err(poem::Error::from_status(
                poem::http::StatusCode::BAD_REQUEST,
            ));
        };
        let relations = include_relations.unwrap_or(false);
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
