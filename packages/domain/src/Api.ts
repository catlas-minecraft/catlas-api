import { HttpApi } from "@effect/platform"
import { AuthApiGroup } from "./AuthApi.js"
import { ChangesetsApiGroup, NodesApiGroup, RelationsApiGroup, ViewportApiGroup, WaysApiGroup } from "./GeospatialApi.js"

export class Api extends HttpApi.make("api")
  .add(AuthApiGroup)
  .add(ViewportApiGroup)
  .add(ChangesetsApiGroup)
  .add(NodesApiGroup)
  .add(WaysApiGroup)
  .add(RelationsApiGroup)
{}
