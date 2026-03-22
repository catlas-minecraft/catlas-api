import { HttpApiBuilder } from "@effect/platform"
import { Api } from "@catlas/domain/Api"
import { Layer } from "effect"
import { AuthLive } from "./auth/AuthHandlers.js"
import { GeospatialLive } from "./geospatial/GeospatialHandlers.js"

export const ApiLive = HttpApiBuilder.api(Api).pipe(
  Layer.provide(AuthLive),
  Layer.provide(GeospatialLive)
)
