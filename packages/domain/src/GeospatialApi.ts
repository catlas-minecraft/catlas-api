import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, HttpApiSecurity } from "@effect/platform"
import { Context, Schema } from "effect"
import * as GeospatialSchema from "@catlas/schema/Geospatial"
import { UnauthorizedError } from "./AuthApi.js"

export const EntityId = GeospatialSchema.EntityId
export type EntityId = typeof GeospatialSchema.EntityId.Type

export const EntityIdFromString = GeospatialSchema.EntityIdFromString
export type EntityIdFromString = typeof GeospatialSchema.EntityIdFromString.Type

export const Tags = GeospatialSchema.Tags
export type Tags = typeof GeospatialSchema.Tags.Type

export const GeometryKind = GeospatialSchema.GeometryKind
export type GeometryKind = typeof GeospatialSchema.GeometryKind.Type

export const Point3D = GeospatialSchema.Point3D
export type Point3D = InstanceType<typeof GeospatialSchema.Point3D>

export const BBox2D = GeospatialSchema.BBox2D
export type BBox2D = InstanceType<typeof GeospatialSchema.BBox2D>

export class ChangesetSnapshot extends Schema.Class<ChangesetSnapshot>("ChangesetSnapshot")({
  id: Schema.Number,
  status: Schema.Literal("open", "published", "abandoned"),
  comment: Schema.Union(Schema.String, Schema.Null),
  createdBy: Schema.String,
  createdAt: Schema.Number,
  publishedAt: Schema.Union(Schema.Number, Schema.Null)
}) {}

export class NodeSnapshot extends Schema.Class<NodeSnapshot>("NodeSnapshot")({
  id: Schema.Number,
  geom: Point3D,
  featureType: Schema.String,
  tags: Tags,
  version: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  createdBy: Schema.String,
  updatedBy: Schema.String,
  deletedAt: Schema.Union(Schema.Number, Schema.Null),
  changesetId: Schema.Number
}) {}

export class WaySnapshot extends Schema.Class<WaySnapshot>("WaySnapshot")({
  id: Schema.Number,
  featureType: Schema.String,
  geometryKind: Schema.Literal("line", "area"),
  isClosed: Schema.Boolean,
  tags: Tags,
  version: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  createdBy: Schema.String,
  updatedBy: Schema.String,
  deletedAt: Schema.Union(Schema.Number, Schema.Null),
  changesetId: Schema.Number
}) {}

export class WayNodeSnapshot extends Schema.Class<WayNodeSnapshot>("WayNodeSnapshot")({
  id: Schema.Number,
  wayId: Schema.Number,
  nodeId: Schema.Number,
  seq: Schema.Number,
  version: Schema.Number,
  changesetId: Schema.Number
}) {}

export class RelationSnapshot extends Schema.Class<RelationSnapshot>("RelationSnapshot")({
  id: Schema.Number,
  relationType: Schema.String,
  tags: Tags,
  version: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  createdBy: Schema.String,
  updatedBy: Schema.String,
  deletedAt: Schema.Union(Schema.Number, Schema.Null),
  changesetId: Schema.Number
}) {}

export class RelationMemberSnapshot extends Schema.Class<RelationMemberSnapshot>("RelationMemberSnapshot")({
  id: Schema.Number,
  relationId: Schema.Number,
  memberType: Schema.Literal("node", "way", "relation"),
  memberId: Schema.Number,
  seq: Schema.Number,
  role: Schema.Union(Schema.String, Schema.Null),
  version: Schema.Number,
  changesetId: Schema.Number
}) {}

export class NodeDetailSnapshot extends Schema.Class<NodeDetailSnapshot>("NodeDetailSnapshot")({
  node: NodeSnapshot
}) {}

export class WayDetailSnapshot extends Schema.Class<WayDetailSnapshot>("WayDetailSnapshot")({
  way: WaySnapshot,
  nodes: Schema.Array(NodeSnapshot),
  wayNodes: Schema.Array(WayNodeSnapshot)
}) {}

export class RelationDetailSnapshot extends Schema.Class<RelationDetailSnapshot>(
  "RelationDetailSnapshot"
)({
  relation: RelationSnapshot,
  relationMembers: Schema.Array(RelationMemberSnapshot)
}) {}

export class RelationMemberInput extends Schema.Class<RelationMemberInput>("RelationMemberInput")({
  memberType: Schema.Literal("node", "way", "relation"),
  memberId: Schema.Number,
  role: Schema.Union(Schema.String, Schema.Null)
}) {}

export class ViewportSnapshot extends Schema.Class<ViewportSnapshot>("ViewportSnapshot")({
  nodes: Schema.Array(NodeSnapshot),
  ways: Schema.Array(WaySnapshot),
  wayNodes: Schema.Array(WayNodeSnapshot),
  relations: Schema.Array(RelationSnapshot),
  relationMembers: Schema.Array(RelationMemberSnapshot)
}) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("NotFoundError", {
  entity: Schema.String,
  id: Schema.Number
}) {}

export class VersionConflictError extends Schema.TaggedError<VersionConflictError>()("VersionConflictError", {
  entity: Schema.String,
  id: Schema.Number,
  expectedVersion: Schema.Number,
  actualVersion: Schema.Number
}) {}

export class InvalidTopologyError extends Schema.TaggedError<InvalidTopologyError>()("InvalidTopologyError", {
  message: Schema.String
}) {}

export class InvalidGeometryStateError extends Schema.TaggedError<InvalidGeometryStateError>()(
  "InvalidGeometryStateError",
  {
    message: Schema.String
  }
) {}

export class ChangesetNotOpenError extends Schema.TaggedError<ChangesetNotOpenError>()("ChangesetNotOpenError", {
  changesetId: Schema.Number
}) {}

export class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  message: Schema.String
}) {}

export class InvalidTagError extends Schema.TaggedError<InvalidTagError>()("InvalidTagError", {
  message: Schema.String
}) {}

export class GeospatialOperationError extends Schema.TaggedError<GeospatialOperationError>()(
  "GeospatialOperationError",
  {
    message: Schema.String
  }
) {}

export class CurrentActor extends Context.Tag("CurrentActor")<
  CurrentActor,
  { readonly actorId: string }
>() {}

export class WriteAuthorization extends HttpApiMiddleware.Tag<WriteAuthorization>()(
  "WriteAuthorization",
  {
    failure: UnauthorizedError,
    provides: CurrentActor,
    security: {
      bearer: HttpApiSecurity.bearer,
      sessionCookie: HttpApiSecurity.apiKey({
        key: "session_jwt",
        in: "cookie"
      })
    }
  }
) {}

const viewportUrlParams = Schema.Struct({
  bbox: Schema.String,
  includeRelations: Schema.optionalWith(Schema.BooleanFromString, {
    default: () => false
  })
})

export class ViewportApiGroup extends HttpApiGroup.make("viewport")
  .add(
    HttpApiEndpoint.get("getViewport", "/")
      .addSuccess(ViewportSnapshot)
      .addError(ValidationError, { status: 400 })
      .addError(GeospatialOperationError, { status: 500 })
      .setUrlParams(viewportUrlParams)
  )
  .prefix("/viewport")
{}

export class ChangesetsApiGroup extends HttpApiGroup.make("changesets")
  .add(
    HttpApiEndpoint.post("createChangeset", "/")
      .addSuccess(ChangesetSnapshot)
      .addError(UnauthorizedError, { status: 401 })
      .addError(ValidationError, { status: 400 })
      .addError(GeospatialOperationError, { status: 500 })
      .setPayload(
        Schema.Struct({
          comment: Schema.Union(Schema.String, Schema.Null)
        })
      )
  )
  .add(
    HttpApiEndpoint.post("publishChangeset")`/${HttpApiSchema.param("id", EntityIdFromString)}/publish`
      .addSuccess(ChangesetSnapshot)
      .addError(UnauthorizedError, { status: 401 })
      .addError(NotFoundError, { status: 404 })
      .addError(VersionConflictError, { status: 409 })
      .addError(ChangesetNotOpenError, { status: 409 })
      .addError(GeospatialOperationError, { status: 500 })
  )
  .add(
    HttpApiEndpoint.post("abandonChangeset")`/${HttpApiSchema.param("id", EntityIdFromString)}/abandon`
      .addSuccess(ChangesetSnapshot)
      .addError(UnauthorizedError, { status: 401 })
      .addError(NotFoundError, { status: 404 })
      .addError(VersionConflictError, { status: 409 })
      .addError(ChangesetNotOpenError, { status: 409 })
      .addError(GeospatialOperationError, { status: 500 })
  )
  .prefix("/changesets")
  .middleware(WriteAuthorization)
{}

export class NodesApiGroup extends HttpApiGroup.make("nodes")
  .add(
    HttpApiEndpoint.get("getNode")`/${HttpApiSchema.param("id", EntityIdFromString)}`
      .addSuccess(NodeDetailSnapshot)
      .addError(NotFoundError, { status: 404 })
      .addError(GeospatialOperationError, { status: 500 })
  )
  .add(
    HttpApiEndpoint.post("createNode", "/")
      .addSuccess(NodeSnapshot)
      .addError(UnauthorizedError, { status: 401 })
      .addError(NotFoundError, { status: 404 })
      .addError(ChangesetNotOpenError, { status: 409 })
      .addError(InvalidTagError, { status: 400 })
      .addError(ValidationError, { status: 400 })
      .addError(GeospatialOperationError, { status: 500 })
      .setPayload(
        Schema.Struct({
          changesetId: EntityId,
          geom: Point3D,
          featureType: Schema.String,
          tags: Tags
        })
      )
      .middleware(WriteAuthorization)
  )
  .add(
    HttpApiEndpoint.patch("updateNode")`/${HttpApiSchema.param("id", EntityIdFromString)}`
      .addSuccess(NodeSnapshot)
      .addError(UnauthorizedError, { status: 401 })
      .addError(NotFoundError, { status: 404 })
      .addError(VersionConflictError, { status: 409 })
      .addError(ChangesetNotOpenError, { status: 409 })
      .addError(InvalidTagError, { status: 400 })
      .addError(ValidationError, { status: 400 })
      .addError(GeospatialOperationError, { status: 500 })
      .setPayload(
        Schema.Struct({
          expectedVersion: Schema.Number,
          changesetId: EntityId,
          geom: Point3D,
          featureType: Schema.String,
          tags: Tags
        })
      )
      .middleware(WriteAuthorization)
  )
  .add(
    HttpApiEndpoint.del("deleteNode")`/${HttpApiSchema.param("id", EntityIdFromString)}`
      .addSuccess(Schema.Void)
      .addError(UnauthorizedError, { status: 401 })
      .addError(NotFoundError, { status: 404 })
      .addError(VersionConflictError, { status: 409 })
      .addError(ChangesetNotOpenError, { status: 409 })
      .addError(InvalidTopologyError, { status: 409 })
      .addError(GeospatialOperationError, { status: 500 })
      .setPayload(
        Schema.Struct({
          expectedVersion: Schema.Number,
          changesetId: EntityId
        })
      )
      .middleware(WriteAuthorization)
  )
  .prefix("/nodes")
{}

const wayPayload = Schema.Struct({
  changesetId: EntityId,
  featureType: Schema.String,
  geometryKind: GeometryKind,
  nodeRefs: Schema.Array(EntityId),
  tags: Tags
})

export class WaysApiGroup extends HttpApiGroup.make("ways")
  .add(
    HttpApiEndpoint.get("getWay")`/${HttpApiSchema.param("id", EntityIdFromString)}`
      .addSuccess(WayDetailSnapshot)
      .addError(NotFoundError, { status: 404 })
      .addError(GeospatialOperationError, { status: 500 })
  )
  .add(
    HttpApiEndpoint.post("createWay", "/")
      .addSuccess(WaySnapshot)
      .addError(UnauthorizedError, { status: 401 })
      .addError(NotFoundError, { status: 404 })
      .addError(ChangesetNotOpenError, { status: 409 })
      .addError(InvalidTagError, { status: 400 })
      .addError(InvalidTopologyError, { status: 409 })
      .addError(InvalidGeometryStateError, { status: 409 })
      .addError(ValidationError, { status: 400 })
      .addError(GeospatialOperationError, { status: 500 })
      .setPayload(wayPayload)
      .middleware(WriteAuthorization)
  )
  .add(
    HttpApiEndpoint.patch("updateWay")`/${HttpApiSchema.param("id", EntityIdFromString)}`
      .addSuccess(WaySnapshot)
      .addError(UnauthorizedError, { status: 401 })
      .addError(NotFoundError, { status: 404 })
      .addError(VersionConflictError, { status: 409 })
      .addError(ChangesetNotOpenError, { status: 409 })
      .addError(InvalidTagError, { status: 400 })
      .addError(InvalidTopologyError, { status: 409 })
      .addError(InvalidGeometryStateError, { status: 409 })
      .addError(ValidationError, { status: 400 })
      .addError(GeospatialOperationError, { status: 500 })
      .setPayload(
        Schema.Struct({
          expectedVersion: Schema.Number,
          changesetId: EntityId,
          featureType: Schema.String,
          geometryKind: GeometryKind,
          nodeRefs: Schema.Array(EntityId),
          tags: Tags
        })
      )
      .middleware(WriteAuthorization)
  )
  .add(
    HttpApiEndpoint.del("deleteWay")`/${HttpApiSchema.param("id", EntityIdFromString)}`
      .addSuccess(Schema.Void)
      .addError(UnauthorizedError, { status: 401 })
      .addError(NotFoundError, { status: 404 })
      .addError(VersionConflictError, { status: 409 })
      .addError(ChangesetNotOpenError, { status: 409 })
      .addError(InvalidTopologyError, { status: 409 })
      .addError(GeospatialOperationError, { status: 500 })
      .setPayload(
        Schema.Struct({
          expectedVersion: Schema.Number,
          changesetId: EntityId
        })
      )
      .middleware(WriteAuthorization)
  )
  .prefix("/ways")
{}

const relationPayload = Schema.Struct({
  changesetId: EntityId,
  relationType: Schema.String,
  members: Schema.Array(RelationMemberInput),
  tags: Tags
})

export class RelationsApiGroup extends HttpApiGroup.make("relations")
  .add(
    HttpApiEndpoint.get("getRelation")`/${HttpApiSchema.param("id", EntityIdFromString)}`
      .addSuccess(RelationDetailSnapshot)
      .addError(NotFoundError, { status: 404 })
      .addError(GeospatialOperationError, { status: 500 })
  )
  .add(
    HttpApiEndpoint.post("createRelation", "/")
      .addSuccess(RelationSnapshot)
      .addError(UnauthorizedError, { status: 401 })
      .addError(NotFoundError, { status: 404 })
      .addError(ChangesetNotOpenError, { status: 409 })
      .addError(InvalidTagError, { status: 400 })
      .addError(InvalidTopologyError, { status: 409 })
      .addError(ValidationError, { status: 400 })
      .addError(GeospatialOperationError, { status: 500 })
      .setPayload(relationPayload)
      .middleware(WriteAuthorization)
  )
  .add(
    HttpApiEndpoint.patch("updateRelation")`/${HttpApiSchema.param("id", EntityIdFromString)}`
      .addSuccess(RelationSnapshot)
      .addError(UnauthorizedError, { status: 401 })
      .addError(NotFoundError, { status: 404 })
      .addError(VersionConflictError, { status: 409 })
      .addError(ChangesetNotOpenError, { status: 409 })
      .addError(InvalidTagError, { status: 400 })
      .addError(InvalidTopologyError, { status: 409 })
      .addError(ValidationError, { status: 400 })
      .addError(GeospatialOperationError, { status: 500 })
      .setPayload(
        Schema.Struct({
          expectedVersion: Schema.Number,
          changesetId: EntityId,
          relationType: Schema.String,
          members: Schema.Array(RelationMemberInput),
          tags: Tags
        })
      )
      .middleware(WriteAuthorization)
  )
  .add(
    HttpApiEndpoint.del("deleteRelation")`/${HttpApiSchema.param("id", EntityIdFromString)}`
      .addSuccess(Schema.Void)
      .addError(UnauthorizedError, { status: 401 })
      .addError(NotFoundError, { status: 404 })
      .addError(VersionConflictError, { status: 409 })
      .addError(ChangesetNotOpenError, { status: 409 })
      .addError(InvalidTopologyError, { status: 409 })
      .addError(GeospatialOperationError, { status: 500 })
      .setPayload(
        Schema.Struct({
          expectedVersion: Schema.Number,
          changesetId: EntityId
        })
      )
      .middleware(WriteAuthorization)
  )
  .prefix("/relations")
{}
