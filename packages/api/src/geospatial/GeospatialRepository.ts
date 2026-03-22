import "@effect/sql-kysely/Pg";
import {
  type BBox2DInput,
  CatlasKysely,
  type ChangeSetRow,
  makeGeometryBBox,
  makeMultipolygonRelationGeometry,
  makeWayGeometry,
  type NodeRow,
  type Point3DInput,
  type RelationGeometryRow,
  RESERVED_TAG_KEYS,
  type RelationMemberRow,
  type RelationRow,
  type WayGeometryRow,
  type WayNodeRow,
  type WayRow,
  intersectsBBox2D,
  makePointZ,
  selectPointZJson,
  withCoreSchema,
  withDerivedSchema,
  withHistorySchema,
} from "@catlas/db";
import {
  type BBox2D,
  ChangesetNotOpenError,
  ChangesetSnapshot,
  GeospatialOperationError,
  type GeometryKind,
  InvalidGeometryStateError,
  InvalidTagError,
  InvalidTopologyError,
  NodeSnapshot,
  NotFoundError,
  Point3D,
  type RelationMemberInput,
  RelationMemberSnapshot,
  RelationSnapshot,
  VersionConflictError,
  ViewportSnapshot,
  WayNodeSnapshot,
  WaySnapshot,
} from "@catlas/domain/GeospatialApi";
import { Context, Effect, Layer } from "effect";

type NodeSelectRow = Omit<NodeRow, "geom"> & { geom_json: Point3DInput };

export interface GeospatialRepositoryService {
  createChangeset: (
    comment: string | null,
    actorId: string,
  ) => Effect.Effect<ChangesetSnapshot, GeospatialOperationError>;
  publishChangeset: (
    id: number,
  ) => Effect.Effect<
    ChangesetSnapshot,
    NotFoundError | ChangesetNotOpenError | VersionConflictError | GeospatialOperationError
  >;
  abandonChangeset: (
    id: number,
  ) => Effect.Effect<
    ChangesetSnapshot,
    NotFoundError | ChangesetNotOpenError | VersionConflictError | GeospatialOperationError
  >;
  createNode: (input: {
    actorId: string;
    changesetId: number;
    geom: Point3D;
    featureType: string;
    tags: Record<string, string>;
  }) => Effect.Effect<
    NodeSnapshot,
    NotFoundError | ChangesetNotOpenError | InvalidTagError | GeospatialOperationError
  >;
  updateNode: (
    id: number,
    input: {
      actorId: string;
      expectedVersion: number;
      changesetId: number;
      geom: Point3D;
      featureType: string;
      tags: Record<string, string>;
    },
  ) => Effect.Effect<
    NodeSnapshot,
    | NotFoundError
    | VersionConflictError
    | ChangesetNotOpenError
    | InvalidTagError
    | GeospatialOperationError
  >;
  deleteNode: (
    id: number,
    input: {
      actorId: string;
      expectedVersion: number;
      changesetId: number;
    },
  ) => Effect.Effect<
    void,
    | NotFoundError
    | VersionConflictError
    | ChangesetNotOpenError
    | InvalidTopologyError
    | GeospatialOperationError
  >;
  createWay: (input: {
    actorId: string;
    changesetId: number;
    featureType: string;
    geometryKind: GeometryKind;
    nodeRefs: ReadonlyArray<number>;
    tags: Record<string, string>;
  }) => Effect.Effect<
    WaySnapshot,
    | NotFoundError
    | ChangesetNotOpenError
    | InvalidTagError
    | InvalidTopologyError
    | InvalidGeometryStateError
    | GeospatialOperationError
  >;
  updateWay: (
    id: number,
    input: {
      actorId: string;
      expectedVersion: number;
      changesetId: number;
      featureType: string;
      geometryKind: GeometryKind;
      nodeRefs: ReadonlyArray<number>;
      tags: Record<string, string>;
    },
  ) => Effect.Effect<
    WaySnapshot,
    | NotFoundError
    | VersionConflictError
    | ChangesetNotOpenError
    | InvalidTagError
    | InvalidTopologyError
    | InvalidGeometryStateError
    | GeospatialOperationError
  >;
  deleteWay: (
    id: number,
    input: {
      actorId: string;
      expectedVersion: number;
      changesetId: number;
    },
  ) => Effect.Effect<
    void,
    | NotFoundError
    | VersionConflictError
    | ChangesetNotOpenError
    | InvalidTopologyError
    | GeospatialOperationError
  >;
  createRelation: (input: {
    actorId: string;
    changesetId: number;
    relationType: string;
    members: ReadonlyArray<RelationMemberInput>;
    tags: Record<string, string>;
  }) => Effect.Effect<
    RelationSnapshot,
    | NotFoundError
    | ChangesetNotOpenError
    | InvalidTagError
    | InvalidTopologyError
    | GeospatialOperationError
  >;
  updateRelation: (
    id: number,
    input: {
      actorId: string;
      expectedVersion: number;
      changesetId: number;
      relationType: string;
      members: ReadonlyArray<RelationMemberInput>;
      tags: Record<string, string>;
    },
  ) => Effect.Effect<
    RelationSnapshot,
    | NotFoundError
    | VersionConflictError
    | ChangesetNotOpenError
    | InvalidTagError
    | InvalidTopologyError
    | GeospatialOperationError
  >;
  deleteRelation: (
    id: number,
    input: {
      actorId: string;
      expectedVersion: number;
      changesetId: number;
    },
  ) => Effect.Effect<
    void,
    | NotFoundError
    | VersionConflictError
    | ChangesetNotOpenError
    | InvalidTopologyError
    | GeospatialOperationError
  >;
  loadViewport: (input: {
    bbox: BBox2D;
    includeRelations: boolean;
  }) => Effect.Effect<ViewportSnapshot, GeospatialOperationError>;
}

const reservedTagKeys = new Set<string>(RESERVED_TAG_KEYS);

const getErrorMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === "string") {
      return message;
    }
  }

  return "Geospatial operation failed";
};

const toOperationError = (cause: unknown) =>
  new GeospatialOperationError({
    message: getErrorMessage(cause),
  });

const normalizeChangesetLifecycleError = (error: unknown) => {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    const tag = (error as { _tag?: unknown })._tag;

    if (
      tag === "NotFoundError" ||
      tag === "ChangesetNotOpenError" ||
      tag === "GeospatialOperationError"
    ) {
      return error as NotFoundError | ChangesetNotOpenError | GeospatialOperationError;
    }
  }

  return toOperationError(error);
};

const runQuery = <T, R>(query: Effect.Effect<T, unknown, R>) =>
  query.pipe(Effect.mapError(toOperationError));

const toEpochMillis = (value: Date) => value.getTime();
const toNullableEpochMillis = (value: Date | null) => (value === null ? null : value.getTime());

const mergeExpectedVersions = (
  expectedVersions: Map<number, number>,
  rows: ReadonlyArray<{ id: number; version: number }>,
  mapVersion: (version: number) => number = (version) => version,
) => {
  for (const row of rows) {
    const nextVersion = mapVersion(row.version);
    const currentVersion = expectedVersions.get(row.id);

    if (currentVersion === undefined || nextVersion > currentVersion) {
      expectedVersions.set(row.id, nextVersion);
    }
  }
};

const toPoint3D = (value: Point3DInput) =>
  new Point3D({
    x: value.x,
    y: value.y,
    z: value.z,
  });

const toChangesetSnapshot = (row: ChangeSetRow) =>
  new ChangesetSnapshot({
    id: row.id,
    status: row.status,
    comment: row.comment,
    createdBy: row.created_by,
    createdAt: toEpochMillis(row.created_at),
    publishedAt: toNullableEpochMillis(row.published_at),
  });

const toNodeSnapshot = (row: NodeSelectRow) =>
  new NodeSnapshot({
    id: row.id,
    geom: toPoint3D(row.geom_json),
    featureType: row.feature_type,
    tags: row.tags,
    version: row.version,
    createdAt: toEpochMillis(row.created_at),
    updatedAt: toEpochMillis(row.updated_at),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    deletedAt: toNullableEpochMillis(row.deleted_at),
    changesetId: row.changeset_id,
  });

const toWaySnapshot = (row: WayRow) =>
  new WaySnapshot({
    id: row.id,
    featureType: row.feature_type,
    geometryKind: row.geometry_kind,
    isClosed: row.is_closed,
    tags: row.tags,
    version: row.version,
    createdAt: toEpochMillis(row.created_at),
    updatedAt: toEpochMillis(row.updated_at),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    deletedAt: toNullableEpochMillis(row.deleted_at),
    changesetId: row.changeset_id,
  });

const toWayNodeSnapshot = (row: WayNodeRow) =>
  new WayNodeSnapshot({
    id: row.id,
    wayId: row.way_id,
    nodeId: row.node_id,
    seq: row.seq,
    version: row.version,
    changesetId: row.changeset_id,
  });

const toRelationSnapshot = (row: RelationRow) =>
  new RelationSnapshot({
    id: row.id,
    relationType: row.relation_type,
    tags: row.tags,
    version: row.version,
    createdAt: toEpochMillis(row.created_at),
    updatedAt: toEpochMillis(row.updated_at),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    deletedAt: toNullableEpochMillis(row.deleted_at),
    changesetId: row.changeset_id,
  });

const toRelationMemberSnapshot = (row: RelationMemberRow) =>
  new RelationMemberSnapshot({
    id: row.id,
    relationId: row.relation_id,
    memberType: row.member_type,
    memberId: row.member_id,
    seq: row.seq,
    role: row.role,
    version: row.version,
    changesetId: row.changeset_id,
  });

const validateTags = (tags: Record<string, string>) => {
  for (const key of Object.keys(tags)) {
    if (reservedTagKeys.has(key)) {
      return Effect.fail(
        new InvalidTagError({
          message: `Tag key '${key}' is reserved`,
        }),
      );
    }
  }

  return Effect.succeed(tags);
};

const validateWayNodeRefs = (
  nodeRefs: ReadonlyArray<number>,
  geometryKind: GeometryKind,
): Effect.Effect<{ isClosed: boolean }, InvalidGeometryStateError> => {
  if (nodeRefs.length < 2) {
    return Effect.fail(
      new InvalidGeometryStateError({
        message: "Way requires at least two node references",
      }),
    );
  }

  const isClosed = nodeRefs[0] === nodeRefs[nodeRefs.length - 1];

  if (geometryKind === "area") {
    if (!isClosed) {
      return Effect.fail(
        new InvalidGeometryStateError({
          message: "Area way must be closed",
        }),
      );
    }

    if (nodeRefs.length < 4) {
      return Effect.fail(
        new InvalidGeometryStateError({
          message: "Area way requires at least four node references",
        }),
      );
    }
  }

  return Effect.succeed({ isClosed });
};

const ensureExpectedVersion = (
  entity: string,
  id: number,
  expectedVersion: number,
  actualVersion: number,
) =>
  expectedVersion === actualVersion
    ? Effect.void
    : Effect.fail(
        new VersionConflictError({
          entity,
          id,
          expectedVersion,
          actualVersion,
        }),
      );

export class GeospatialRepository extends Context.Tag(
  "@catlas/api/geospatial/GeospatialRepository",
)<GeospatialRepository, GeospatialRepositoryService>() {}

export const GeospatialRepositoryLive = Layer.effect(
  GeospatialRepository,
  Effect.gen(function* () {
    const db = yield* CatlasKysely;
    const coreDb = withCoreSchema(db);
    const derivedDb = withDerivedSchema(db);
    const historyDb = withHistorySchema(db);

    const loadChangesetById = (id: number) =>
      coreDb
        .selectFrom("changesets")
        .selectAll()
        .where("id", "=", id)
        .pipe(
          runQuery,
          Effect.map((rows) => rows[0]),
          Effect.flatMap((row) =>
            row === undefined
              ? Effect.fail(new NotFoundError({ entity: "changeset", id }))
              : Effect.succeed(row),
          ),
        );

    const ensureOpenChangeset = (id: number) =>
      loadChangesetById(id).pipe(
        Effect.flatMap((row) =>
          row.status === "open"
            ? Effect.succeed(row)
            : Effect.fail(new ChangesetNotOpenError({ changesetId: id })),
        ),
      );

    const loadNodeById = (id: number) =>
      coreDb
        .selectFrom("nodes")
        .select([
          "id",
          "feature_type",
          "tags",
          "version",
          "created_at",
          "updated_at",
          "created_by",
          "updated_by",
          "deleted_at",
          "changeset_id",
          selectPointZJson("geom").as("geom_json"),
        ])
        .where("id", "=", id)
        .where("deleted_at", "is", null)
        .pipe(
          runQuery,
          Effect.map((rows) => rows[0]),
          Effect.flatMap((row) =>
            row === undefined
              ? Effect.fail(new NotFoundError({ entity: "node", id }))
              : Effect.succeed(row as NodeSelectRow),
          ),
        );

    const ensureNodeNotReferenced = (
      id: number,
    ): Effect.Effect<void, InvalidTopologyError | GeospatialOperationError> =>
      coreDb
        .selectFrom("way_nodes")
        .innerJoin("ways", "ways.id", "way_nodes.way_id")
        .select("way_nodes.id")
        .where("way_nodes.node_id", "=", id)
        .where("ways.deleted_at", "is", null)
        .limit(1)
        .pipe(
          runQuery,
          Effect.flatMap((rows) =>
            rows.length > 0
              ? Effect.fail(
                  new InvalidTopologyError({
                    message: "Node is still referenced by an active way",
                  }),
                )
              : Effect.void,
          ),
        );

    const ensureWayNotReferenced = (
      id: number,
    ): Effect.Effect<void, InvalidTopologyError | GeospatialOperationError> =>
      coreDb
        .selectFrom("relation_members")
        .innerJoin("relations", "relations.id", "relation_members.relation_id")
        .select("relation_members.id")
        .where("relation_members.member_type", "=", "way")
        .where("relation_members.member_id", "=", id)
        .where("relations.deleted_at", "is", null)
        .limit(1)
        .pipe(
          runQuery,
          Effect.flatMap((rows) =>
            rows.length > 0
              ? Effect.fail(
                  new InvalidTopologyError({
                    message: "Way is still referenced by an active relation",
                  }),
                )
              : Effect.void,
          ),
        );

    const ensureRelationNotReferenced = (
      id: number,
    ): Effect.Effect<void, InvalidTopologyError | GeospatialOperationError> =>
      coreDb
        .selectFrom("relation_members")
        .innerJoin("relations", "relations.id", "relation_members.relation_id")
        .select("relation_members.id")
        .where("relation_members.member_type", "=", "relation")
        .where("relation_members.member_id", "=", id)
        .where("relations.deleted_at", "is", null)
        .limit(1)
        .pipe(
          runQuery,
          Effect.flatMap((rows) =>
            rows.length > 0
              ? Effect.fail(
                  new InvalidTopologyError({
                    message: "Relation is still referenced by an active relation",
                  }),
                )
              : Effect.void,
          ),
        );

    const ensureNodesExist = (nodeRefs: ReadonlyArray<number>) =>
      Effect.forEach([...new Set(nodeRefs)], (nodeId) => loadNodeById(nodeId), {
        discard: true,
      });

    const loadWayById = (id: number) =>
      coreDb
        .selectFrom("ways")
        .selectAll()
        .where("id", "=", id)
        .where("deleted_at", "is", null)
        .pipe(
          runQuery,
          Effect.map((rows) => rows[0]),
          Effect.flatMap((row) =>
            row === undefined
              ? Effect.fail(new NotFoundError({ entity: "way", id }))
              : Effect.succeed(row),
          ),
        );

    const loadRelationById = (id: number) =>
      coreDb
        .selectFrom("relations")
        .selectAll()
        .where("id", "=", id)
        .where("deleted_at", "is", null)
        .pipe(
          runQuery,
          Effect.map((rows) => rows[0]),
          Effect.flatMap((row) =>
            row === undefined
              ? Effect.fail(new NotFoundError({ entity: "relation", id }))
              : Effect.succeed(row),
          ),
        );

    const loadWayNodesByWayId = (wayId: number) =>
      coreDb
        .selectFrom("way_nodes")
        .selectAll()
        .where("way_id", "=", wayId)
        .orderBy("seq", "asc")
        .pipe(runQuery);

    const loadRelationMembersByRelationId = (relationId: number) =>
      coreDb
        .selectFrom("relation_members")
        .selectAll()
        .where("relation_id", "=", relationId)
        .orderBy("seq", "asc")
        .pipe(runQuery);

    const recordNodeVersion = (row: NodeSelectRow, changesetId: number) =>
      historyDb
        .insertInto("node_versions")
        .values({
          node_id: row.id,
          version: row.version,
          snapshot: {
            ...row,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            deleted_at: row.deleted_at?.toISOString() ?? null,
          },
          changeset_id: changesetId,
          recorded_at: new Date(),
        })
        .pipe(runQuery, Effect.asVoid);

    const recordWayVersion = (row: WayRow, changesetId: number) =>
      historyDb
        .insertInto("way_versions")
        .values({
          way_id: row.id,
          version: row.version,
          snapshot: {
            ...row,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            deleted_at: row.deleted_at?.toISOString() ?? null,
          },
          changeset_id: changesetId,
          recorded_at: new Date(),
        })
        .pipe(runQuery, Effect.asVoid);

    const recordWayNodeVersions = (rows: ReadonlyArray<WayNodeRow>, changesetId: number) =>
      Effect.forEach(
        rows,
        (row) =>
          historyDb
            .insertInto("way_node_versions")
            .values({
              way_node_id: row.id,
              version: row.version,
              snapshot: row,
              changeset_id: changesetId,
              recorded_at: new Date(),
            })
            .pipe(runQuery, Effect.asVoid),
        { discard: true },
      );

    const recordRelationVersion = (row: RelationRow, changesetId: number) =>
      historyDb
        .insertInto("relation_versions")
        .values({
          relation_id: row.id,
          version: row.version,
          snapshot: {
            ...row,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            deleted_at: row.deleted_at?.toISOString() ?? null,
          },
          changeset_id: changesetId,
          recorded_at: new Date(),
        })
        .pipe(runQuery, Effect.asVoid);

    const recordRelationMemberVersions = (
      rows: ReadonlyArray<RelationMemberRow>,
      changesetId: number,
    ) =>
      Effect.forEach(
        rows,
        (row) =>
          historyDb
            .insertInto("relation_member_versions")
            .values({
              relation_member_id: row.id,
              version: row.version,
              snapshot: row,
              changeset_id: changesetId,
              recorded_at: new Date(),
            })
            .pipe(runQuery, Effect.asVoid),
        { discard: true },
      );

    const replaceWayNodes = (
      wayId: number,
      nodeRefs: ReadonlyArray<number>,
      changesetId: number,
      version: number,
    ) =>
      coreDb
        .deleteFrom("way_nodes")
        .where("way_id", "=", wayId)
        .pipe(
          runQuery,
          Effect.zipRight(
            Effect.forEach(
              nodeRefs.map((nodeId, seq) => ({ nodeId, seq })),
              ({ nodeId, seq }) =>
                coreDb
                  .insertInto("way_nodes")
                  .values({
                    way_id: wayId,
                    node_id: nodeId,
                    seq,
                    version,
                    changeset_id: changesetId,
                  })
                  .pipe(runQuery, Effect.asVoid),
              { discard: true },
            ),
          ),
        );

    const replaceRelationMembers = (
      relationId: number,
      members: ReadonlyArray<RelationMemberInput>,
      changesetId: number,
      version: number,
    ) =>
      coreDb
        .deleteFrom("relation_members")
        .where("relation_id", "=", relationId)
        .pipe(
          runQuery,
          Effect.zipRight(
            Effect.forEach(
              members.map((member, seq) => ({ member, seq })),
              ({ member, seq }) =>
                coreDb
                  .insertInto("relation_members")
                  .values({
                    relation_id: relationId,
                    member_type: member.memberType,
                    member_id: member.memberId,
                    seq,
                    role: member.role,
                    version,
                    changeset_id: changesetId,
                  })
                  .pipe(runQuery, Effect.asVoid),
              { discard: true },
            ),
          ),
        );

    const ensureRelationMemberExists = (
      member: RelationMemberInput,
      currentRelationId?: number,
    ): Effect.Effect<void, NotFoundError | InvalidTopologyError | GeospatialOperationError> => {
      if (member.memberType === "node") {
        return loadNodeById(member.memberId).pipe(Effect.asVoid);
      }

      if (member.memberType === "way") {
        return loadWayById(member.memberId).pipe(Effect.asVoid);
      }

      if (currentRelationId !== undefined && member.memberId === currentRelationId) {
        return Effect.fail(
          new InvalidTopologyError({
            message: "Relation cannot reference itself",
          }),
        );
      }

      return loadRelationById(member.memberId).pipe(Effect.asVoid);
    };

    const ensureRelationMembersExist = (
      members: ReadonlyArray<RelationMemberInput>,
      currentRelationId?: number,
    ) =>
      Effect.forEach(members, (member) => ensureRelationMemberExists(member, currentRelationId), {
        discard: true,
      });

    const syncWayGeometry = (
      wayId: number,
      geometryKind: GeometryKind,
      sourceVersion: number,
    ): Effect.Effect<void, GeospatialOperationError> => {
      const geom = makeWayGeometry(wayId, geometryKind);
      const bbox = makeGeometryBBox(geom);

      return derivedDb
        .deleteFrom("way_geometries")
        .where("way_id", "=", wayId)
        .pipe(
          runQuery,
          Effect.zipRight(
            derivedDb
              .insertInto("way_geometries")
              .values({
                way_id: wayId,
                geom,
                bbox,
                source_version: sourceVersion,
                refreshed_at: new Date(),
              } satisfies Omit<WayGeometryRow, "refreshed_at"> & { refreshed_at: Date })
              .pipe(runQuery, Effect.asVoid),
          ),
        );
    };

    const deleteWayGeometry = (wayId: number) =>
      derivedDb
        .deleteFrom("way_geometries")
        .where("way_id", "=", wayId)
        .pipe(runQuery, Effect.asVoid);

    const deleteRelationGeometry = (relationId: number) =>
      derivedDb
        .deleteFrom("relation_geometries")
        .where("relation_id", "=", relationId)
        .pipe(runQuery, Effect.asVoid);

    const isRenderableMultipolygonRelation = (relationId: number) =>
      coreDb
        .selectFrom("relation_members")
        .select(["member_type", "member_id", "role"])
        .where("relation_id", "=", relationId)
        .pipe(
          runQuery,
          Effect.flatMap((memberRows) => {
            if (memberRows.length === 0) {
              return Effect.succeed(false);
            }

            if (memberRows.some((row) => row.member_type !== "way")) {
              return Effect.succeed(false);
            }

            if (
              memberRows.some(
                (row) => row.role !== null && row.role !== "outer" && row.role !== "inner",
              )
            ) {
              return Effect.succeed(false);
            }

            const wayIds = [...new Set(memberRows.map((row) => row.member_id))];
            const outerWayIds = [
              ...new Set(
                memberRows
                  .filter((row) => row.role === null || row.role === "outer")
                  .map((row) => row.member_id),
              ),
            ];

            if (outerWayIds.length === 0) {
              return Effect.succeed(false);
            }

            return coreDb
              .selectFrom("ways")
              .select(["id", "geometry_kind", "deleted_at"])
              .where("id", "in", wayIds)
              .pipe(
                runQuery,
                Effect.flatMap((wayRows) => {
                  if (
                    wayRows.length !== wayIds.length ||
                    wayRows.some((row) => row.deleted_at !== null || row.geometry_kind !== "area")
                  ) {
                    return Effect.succeed(false);
                  }

                  return derivedDb
                    .selectFrom("way_geometries")
                    .select("way_id")
                    .where("way_id", "in", wayIds)
                    .pipe(
                      runQuery,
                      Effect.map((geometryRows) => geometryRows.length === wayIds.length),
                    );
                }),
              );
          }),
        );

    const syncRelationGeometry = (
      relationId: number,
      relationType: string,
      sourceVersion: number,
    ): Effect.Effect<void, GeospatialOperationError> => {
      if (relationType !== "multipolygon") {
        return deleteRelationGeometry(relationId);
      }

      const geom = makeMultipolygonRelationGeometry(relationId);
      const bbox = makeGeometryBBox(geom);

      return isRenderableMultipolygonRelation(relationId).pipe(
        Effect.flatMap((isRenderable) =>
          !isRenderable
            ? deleteRelationGeometry(relationId)
            : derivedDb
                .deleteFrom("relation_geometries")
                .where("relation_id", "=", relationId)
                .pipe(
                  runQuery,
                  Effect.zipRight(
                    derivedDb
                      .insertInto("relation_geometries")
                      .values({
                        relation_id: relationId,
                        geom,
                        bbox,
                        source_version: sourceVersion,
                        refreshed_at: new Date(),
                      } satisfies Omit<RelationGeometryRow, "refreshed_at"> & {
                        refreshed_at: Date;
                      })
                      .pipe(runQuery, Effect.asVoid),
                  ),
                ),
        ),
      );
    };

    const collectChangedNodeIds = (changesetId: number) =>
      coreDb
        .selectFrom("nodes")
        .select("id")
        .where("changeset_id", "=", changesetId)
        .pipe(
          runQuery,
          Effect.map((rows) => [...new Set(rows.map((row) => row.id))]),
        );

    const collectTouchedNodeVersions = (changesetId: number) =>
      Effect.gen(function* () {
        const currentRows = yield* coreDb
          .selectFrom("nodes")
          .select(["id", "version"])
          .where("changeset_id", "=", changesetId)
          .pipe(runQuery);

        const historyRows = yield* historyDb
          .selectFrom("node_versions")
          .select(["node_id as id", "version"])
          .where("changeset_id", "=", changesetId)
          .pipe(runQuery);

        const expectedVersions = new Map<number, number>();
        mergeExpectedVersions(expectedVersions, currentRows);
        mergeExpectedVersions(expectedVersions, historyRows, (version) => version + 1);

        return expectedVersions;
      });

    const collectChangedWayIds = (changesetId: number) =>
      Effect.gen(function* () {
        const directWayIds = yield* coreDb
          .selectFrom("ways")
          .select("id")
          .where("changeset_id", "=", changesetId)
          .pipe(
            runQuery,
            Effect.map((rows) => rows.map((row) => row.id)),
          );

        const wayNodeWayIds = yield* coreDb
          .selectFrom("way_nodes")
          .select("way_id")
          .where("changeset_id", "=", changesetId)
          .pipe(
            runQuery,
            Effect.map((rows) => rows.map((row) => row.way_id)),
          );

        const changedNodeIds = yield* collectChangedNodeIds(changesetId);

        const referencedWayIds =
          changedNodeIds.length === 0
            ? []
            : yield* coreDb
                .selectFrom("way_nodes")
                .innerJoin("ways", "ways.id", "way_nodes.way_id")
                .select("way_nodes.way_id")
                .where("way_nodes.node_id", "in", changedNodeIds)
                .where("ways.deleted_at", "is", null)
                .pipe(
                  runQuery,
                  Effect.map((rows) => rows.map((row) => row.way_id)),
                );

        return [...new Set([...directWayIds, ...wayNodeWayIds, ...referencedWayIds])];
      });

    const collectTouchedWayVersions = (changesetId: number) =>
      Effect.gen(function* () {
        const currentRows = yield* coreDb
          .selectFrom("ways")
          .select(["id", "version"])
          .where("changeset_id", "=", changesetId)
          .pipe(runQuery);

        const historyRows = yield* historyDb
          .selectFrom("way_versions")
          .select(["way_id as id", "version"])
          .where("changeset_id", "=", changesetId)
          .pipe(runQuery);

        const expectedVersions = new Map<number, number>();
        mergeExpectedVersions(expectedVersions, currentRows);
        mergeExpectedVersions(expectedVersions, historyRows, (version) => version + 1);

        return expectedVersions;
      });

    const collectTouchedRelationIds = (changesetId: number, changedWayIds: ReadonlyArray<number>) =>
      Effect.gen(function* () {
        const directRelationIds = yield* coreDb
          .selectFrom("relations")
          .select("id")
          .where("changeset_id", "=", changesetId)
          .pipe(
            runQuery,
            Effect.map((rows) => rows.map((row) => row.id)),
          );

        const changedNodeIds = yield* collectChangedNodeIds(changesetId);

        const memberRelationIds = yield* coreDb
          .selectFrom("relation_members")
          .select("relation_id")
          .where((eb) =>
            eb.or([
              eb("changeset_id", "=", changesetId),
              changedWayIds.length === 0
                ? eb.val(false)
                : eb.and([eb("member_type", "=", "way"), eb("member_id", "in", changedWayIds)]),
              changedNodeIds.length === 0
                ? eb.val(false)
                : eb.and([eb("member_type", "=", "node"), eb("member_id", "in", changedNodeIds)]),
            ]),
          )
          .pipe(
            runQuery,
            Effect.map((rows) => rows.map((row) => row.relation_id)),
          );

        return [...new Set([...directRelationIds, ...memberRelationIds])];
      });

    const collectTouchedRelationVersions = (changesetId: number) =>
      Effect.gen(function* () {
        const currentRows = yield* coreDb
          .selectFrom("relations")
          .select(["id", "version"])
          .where("changeset_id", "=", changesetId)
          .pipe(runQuery);

        const historyRows = yield* historyDb
          .selectFrom("relation_versions")
          .select(["relation_id as id", "version"])
          .where("changeset_id", "=", changesetId)
          .pipe(runQuery);

        const expectedVersions = new Map<number, number>();
        mergeExpectedVersions(expectedVersions, currentRows);
        mergeExpectedVersions(expectedVersions, historyRows, (version) => version + 1);

        return expectedVersions;
      });

    const ensureDraftOwnership = (
      entity: "node" | "way" | "relation",
      changesetId: number,
      expectedVersions: ReadonlyMap<number, number>,
    ): Effect.Effect<void, VersionConflictError | GeospatialOperationError> => {
      const ids = [...expectedVersions.keys()];

      if (ids.length === 0) {
        return Effect.void;
      }

      const loadRows =
        entity === "node"
          ? coreDb
              .selectFrom("nodes")
              .select(["id", "version", "changeset_id"])
              .where("id", "in", ids)
              .pipe(runQuery)
          : entity === "way"
            ? coreDb
                .selectFrom("ways")
                .select(["id", "version", "changeset_id"])
                .where("id", "in", ids)
                .pipe(runQuery)
            : coreDb
                .selectFrom("relations")
                .select(["id", "version", "changeset_id"])
                .where("id", "in", ids)
                .pipe(runQuery);

      return loadRows.pipe(
        Effect.flatMap((rows) => {
          const currentRows = new Map(rows.map((row) => [row.id, row]));

          for (const id of ids) {
            const row = currentRows.get(id);

            if (row === undefined || row.changeset_id !== changesetId) {
              return Effect.fail(
                new VersionConflictError({
                  entity,
                  id,
                  expectedVersion: expectedVersions.get(id) ?? 0,
                  actualVersion: row?.version ?? 0,
                }),
              );
            }
          }

          return Effect.void;
        }),
      );
    };

    const refreshWayGeometries = (wayIds: ReadonlyArray<number>) =>
      Effect.forEach(
        wayIds,
        (wayId) =>
          coreDb
            .selectFrom("ways")
            .select(["id", "geometry_kind", "version", "deleted_at"])
            .where("id", "=", wayId)
            .pipe(
              runQuery,
              Effect.map((rows) => rows[0]),
              Effect.flatMap((row) =>
                row === undefined || row.deleted_at !== null
                  ? deleteWayGeometry(wayId)
                  : syncWayGeometry(row.id, row.geometry_kind, row.version),
              ),
            ),
        { discard: true },
      );

    const clearRelationGeometries = (relationIds: ReadonlyArray<number>) =>
      Effect.forEach(relationIds, (relationId) => deleteRelationGeometry(relationId), {
        discard: true,
      });

    const refreshRelationGeometries = (relationIds: ReadonlyArray<number>) =>
      Effect.forEach(
        relationIds,
        (relationId) =>
          coreDb
            .selectFrom("relations")
            .select(["id", "relation_type", "version", "deleted_at"])
            .where("id", "=", relationId)
            .pipe(
              runQuery,
              Effect.map((rows) => rows[0]),
              Effect.flatMap((row) =>
                row === undefined || row.deleted_at !== null
                  ? deleteRelationGeometry(relationId)
                  : syncRelationGeometry(row.id, row.relation_type, row.version),
              ),
            ),
        { discard: true },
      );

    const pickEarliestSnapshots = <T extends { version: number }, K extends string | number>(
      rows: ReadonlyArray<T>,
      keyOf: (row: T) => K,
    ) => {
      const earliest = new Map<K, T>();

      for (const row of rows) {
        const key = keyOf(row);
        const current = earliest.get(key);

        if (current === undefined || row.version < current.version) {
          earliest.set(key, row);
        }
      }

      return [...earliest.values()];
    };

    const restoreNodeSnapshot = (snapshot: any) =>
      coreDb
        .updateTable("nodes")
        .set({
          geom: makePointZ(snapshot.geom_json),
          feature_type: snapshot.feature_type,
          tags: snapshot.tags,
          version: snapshot.version,
          created_changeset_id: snapshot.created_changeset_id,
          created_at: new Date(snapshot.created_at),
          updated_at: new Date(snapshot.updated_at),
          created_by: snapshot.created_by,
          updated_by: snapshot.updated_by,
          deleted_at: snapshot.deleted_at === null ? null : new Date(snapshot.deleted_at),
          changeset_id: snapshot.changeset_id,
        })
        .where("id", "=", snapshot.id)
        .pipe(runQuery, Effect.asVoid);

    const restoreWaySnapshot = (snapshot: any) =>
      coreDb
        .updateTable("ways")
        .set({
          feature_type: snapshot.feature_type,
          geometry_kind: snapshot.geometry_kind,
          is_closed: snapshot.is_closed,
          tags: snapshot.tags,
          version: snapshot.version,
          created_changeset_id: snapshot.created_changeset_id,
          created_at: new Date(snapshot.created_at),
          updated_at: new Date(snapshot.updated_at),
          created_by: snapshot.created_by,
          updated_by: snapshot.updated_by,
          deleted_at: snapshot.deleted_at === null ? null : new Date(snapshot.deleted_at),
          changeset_id: snapshot.changeset_id,
        })
        .where("id", "=", snapshot.id)
        .pipe(runQuery, Effect.asVoid);

    const restoreWayNodeSnapshots = (wayId: number, snapshots: ReadonlyArray<any>) =>
      coreDb
        .deleteFrom("way_nodes")
        .where("way_id", "=", wayId)
        .pipe(
          runQuery,
          Effect.zipRight(
            Effect.forEach(
              snapshots,
              (snapshot) =>
                coreDb
                  .insertInto("way_nodes")
                  .values({
                    id: snapshot.id,
                    way_id: snapshot.way_id,
                    node_id: snapshot.node_id,
                    seq: snapshot.seq,
                    version: snapshot.version,
                    changeset_id: snapshot.changeset_id,
                  })
                  .pipe(runQuery, Effect.asVoid),
              { discard: true },
            ),
          ),
        );

    const restoreRelationSnapshot = (snapshot: any) =>
      coreDb
        .updateTable("relations")
        .set({
          relation_type: snapshot.relation_type,
          tags: snapshot.tags,
          version: snapshot.version,
          created_changeset_id: snapshot.created_changeset_id,
          created_at: new Date(snapshot.created_at),
          updated_at: new Date(snapshot.updated_at),
          created_by: snapshot.created_by,
          updated_by: snapshot.updated_by,
          deleted_at: snapshot.deleted_at === null ? null : new Date(snapshot.deleted_at),
          changeset_id: snapshot.changeset_id,
        })
        .where("id", "=", snapshot.id)
        .pipe(runQuery, Effect.asVoid);

    const restoreRelationMemberSnapshots = (relationId: number, snapshots: ReadonlyArray<any>) =>
      coreDb
        .deleteFrom("relation_members")
        .where("relation_id", "=", relationId)
        .pipe(
          runQuery,
          Effect.zipRight(
            Effect.forEach(
              snapshots,
              (snapshot) =>
                coreDb
                  .insertInto("relation_members")
                  .values({
                    id: snapshot.id,
                    relation_id: snapshot.relation_id,
                    member_type: snapshot.member_type,
                    member_id: snapshot.member_id,
                    seq: snapshot.seq,
                    role: snapshot.role,
                    version: snapshot.version,
                    changeset_id: snapshot.changeset_id,
                  })
                  .pipe(runQuery, Effect.asVoid),
              { discard: true },
            ),
          ),
        );

    const createChangeset = (comment: string | null, actorId: string) =>
      coreDb
        .insertInto("changesets")
        .values({
          status: "open",
          comment,
          created_by: actorId,
          created_at: new Date(),
        })
        .returningAll()
        .pipe(
          runQuery,
          Effect.map((rows) => toChangesetSnapshot(rows[0] as ChangeSetRow)),
        );

    const publishChangeset = (id: number) =>
      db
        .withTransaction(
          ensureOpenChangeset(id).pipe(
            Effect.flatMap(() =>
              Effect.gen(function* () {
                const touchedNodeVersions = yield* collectTouchedNodeVersions(id);
                const touchedWayVersions = yield* collectTouchedWayVersions(id);
                const touchedRelationVersions = yield* collectTouchedRelationVersions(id);
                const changedWayIds = yield* collectChangedWayIds(id);
                const touchedRelationIds = yield* collectTouchedRelationIds(id, changedWayIds);

                yield* ensureDraftOwnership("node", id, touchedNodeVersions);
                yield* ensureDraftOwnership("way", id, touchedWayVersions);
                yield* ensureDraftOwnership("relation", id, touchedRelationVersions);

                yield* refreshWayGeometries(changedWayIds);
                yield* refreshRelationGeometries(touchedRelationIds);

                return yield* coreDb
                  .updateTable("changesets")
                  .set({
                    status: "published",
                    published_at: new Date(),
                  })
                  .where("id", "=", id)
                  .returningAll()
                  .pipe(
                    runQuery,
                    Effect.map((rows) => toChangesetSnapshot(rows[0] as ChangeSetRow)),
                  );
              }),
            ),
          ),
        )
        .pipe(Effect.mapError(normalizeChangesetLifecycleError));

    const abandonChangeset = (id: number) =>
      db
        .withTransaction(
          ensureOpenChangeset(id).pipe(
            Effect.flatMap(() =>
              Effect.gen(function* () {
                const touchedNodeVersions = yield* collectTouchedNodeVersions(id);
                const touchedWayVersions = yield* collectTouchedWayVersions(id);
                const touchedRelationVersions = yield* collectTouchedRelationVersions(id);
                const rollbackWayIds = yield* collectChangedWayIds(id);
                const touchedRelationIds = yield* collectTouchedRelationIds(id, rollbackWayIds);

                yield* ensureDraftOwnership("node", id, touchedNodeVersions);
                yield* ensureDraftOwnership("way", id, touchedWayVersions);
                yield* ensureDraftOwnership("relation", id, touchedRelationVersions);

                const createdRelations = yield* coreDb
                  .selectFrom("relations")
                  .select(["id"])
                  .where("changeset_id", "=", id)
                  .where("created_changeset_id", "=", id)
                  .pipe(runQuery);

                const createdWays = yield* coreDb
                  .selectFrom("ways")
                  .select(["id"])
                  .where("changeset_id", "=", id)
                  .where("created_changeset_id", "=", id)
                  .pipe(runQuery);

                const createdNodes = yield* coreDb
                  .selectFrom("nodes")
                  .select(["id"])
                  .where("changeset_id", "=", id)
                  .where("created_changeset_id", "=", id)
                  .pipe(runQuery);

                const createdRelationIds = new Set(createdRelations.map((row) => row.id));
                const createdWayIds = new Set(createdWays.map((row) => row.id));
                const createdNodeIds = new Set(createdNodes.map((row) => row.id));

                const relationVersionRows = yield* historyDb
                  .selectFrom("relation_versions")
                  .selectAll()
                  .where("changeset_id", "=", id)
                  .pipe(runQuery);
                const relationSnapshots = pickEarliestSnapshots(
                  relationVersionRows,
                  (row) => row.relation_id,
                )
                  .map((row) => row.snapshot as any)
                  .filter((snapshot) => !createdRelationIds.has(snapshot.id));

                const relationMemberVersionRows = yield* historyDb
                  .selectFrom("relation_member_versions")
                  .selectAll()
                  .where("changeset_id", "=", id)
                  .pipe(runQuery);
                const relationMemberSnapshots = pickEarliestSnapshots(
                  relationMemberVersionRows,
                  (row) => row.relation_member_id,
                )
                  .map((row) => row.snapshot as any)
                  .filter((snapshot) => snapshot.changeset_id !== id);

                const wayVersionRows = yield* historyDb
                  .selectFrom("way_versions")
                  .selectAll()
                  .where("changeset_id", "=", id)
                  .pipe(runQuery);
                const waySnapshots = pickEarliestSnapshots(wayVersionRows, (row) => row.way_id)
                  .map((row) => row.snapshot as any)
                  .filter((snapshot) => !createdWayIds.has(snapshot.id));

                const wayNodeVersionRows = yield* historyDb
                  .selectFrom("way_node_versions")
                  .selectAll()
                  .where("changeset_id", "=", id)
                  .pipe(runQuery);
                const wayNodeSnapshots = pickEarliestSnapshots(
                  wayNodeVersionRows,
                  (row) => row.way_node_id,
                )
                  .map((row) => row.snapshot as any)
                  .filter((snapshot) => snapshot.changeset_id !== id);

                const nodeVersionRows = yield* historyDb
                  .selectFrom("node_versions")
                  .selectAll()
                  .where("changeset_id", "=", id)
                  .pipe(runQuery);
                const nodeSnapshots = pickEarliestSnapshots(nodeVersionRows, (row) => row.node_id)
                  .map((row) => row.snapshot as any)
                  .filter((snapshot) => !createdNodeIds.has(snapshot.id));

                const relationIdsToReset = [
                  ...new Set([
                    ...createdRelations.map((row) => row.id),
                    ...relationSnapshots.map((snapshot) => snapshot.id),
                  ]),
                ];

                if (relationIdsToReset.length > 0) {
                  yield* coreDb
                    .deleteFrom("relation_members")
                    .where("relation_id", "in", relationIdsToReset)
                    .pipe(runQuery, Effect.asVoid);
                }

                yield* Effect.forEach(
                  relationSnapshots,
                  (snapshot) =>
                    restoreRelationSnapshot(snapshot).pipe(
                      Effect.zipRight(
                        restoreRelationMemberSnapshots(
                          snapshot.id,
                          relationMemberSnapshots.filter(
                            (memberSnapshot) => memberSnapshot.relation_id === snapshot.id,
                          ),
                        ),
                      ),
                    ),
                  { discard: true },
                );

                if (createdRelationIds.size > 0) {
                  yield* clearRelationGeometries([...createdRelationIds]);
                  yield* coreDb
                    .deleteFrom("relations")
                    .where("id", "in", [...createdRelationIds])
                    .pipe(runQuery, Effect.asVoid);
                }

                const wayIdsToReset = [
                  ...new Set([
                    ...createdWays.map((row) => row.id),
                    ...waySnapshots.map((snapshot) => snapshot.id),
                  ]),
                ];

                if (wayIdsToReset.length > 0) {
                  yield* coreDb
                    .deleteFrom("way_nodes")
                    .where("way_id", "in", wayIdsToReset)
                    .pipe(runQuery, Effect.asVoid);
                }

                yield* Effect.forEach(
                  waySnapshots,
                  (snapshot) =>
                    restoreWaySnapshot(snapshot).pipe(
                      Effect.zipRight(
                        restoreWayNodeSnapshots(
                          snapshot.id,
                          wayNodeSnapshots.filter(
                            (wayNodeSnapshot) => wayNodeSnapshot.way_id === snapshot.id,
                          ),
                        ),
                      ),
                    ),
                  { discard: true },
                );

                if (createdWayIds.size > 0) {
                  yield* Effect.forEach([...createdWayIds], (wayId) => deleteWayGeometry(wayId), {
                    discard: true,
                  });
                  yield* coreDb
                    .deleteFrom("ways")
                    .where("id", "in", [...createdWayIds])
                    .pipe(runQuery, Effect.asVoid);
                }

                yield* Effect.forEach(nodeSnapshots, (snapshot) => restoreNodeSnapshot(snapshot), {
                  discard: true,
                });

                if (createdNodeIds.size > 0) {
                  yield* coreDb
                    .deleteFrom("nodes")
                    .where("id", "in", [...createdNodeIds])
                    .pipe(runQuery, Effect.asVoid);
                }

                yield* refreshWayGeometries(rollbackWayIds);
                yield* refreshRelationGeometries(touchedRelationIds);

                return yield* coreDb
                  .updateTable("changesets")
                  .set({
                    status: "abandoned",
                  })
                  .where("id", "=", id)
                  .returningAll()
                  .pipe(
                    runQuery,
                    Effect.map((rows) => toChangesetSnapshot(rows[0] as ChangeSetRow)),
                  );
              }),
            ),
          ),
        )
        .pipe(Effect.mapError(normalizeChangesetLifecycleError));

    const createNode = (input: {
      actorId: string;
      changesetId: number;
      geom: Point3D;
      featureType: string;
      tags: Record<string, string>;
    }) =>
      ensureOpenChangeset(input.changesetId).pipe(
        Effect.zipRight(validateTags(input.tags)),
        Effect.flatMap(() =>
          coreDb
            .insertInto("nodes")
            .values({
              geom: makePointZ(input.geom),
              feature_type: input.featureType,
              tags: input.tags,
              version: 1,
              created_changeset_id: input.changesetId,
              created_at: new Date(),
              updated_at: new Date(),
              changeset_id: input.changesetId,
              created_by: input.actorId,
              updated_by: input.actorId,
            })
            .returning("id")
            .pipe(runQuery),
        ),
        Effect.flatMap((rows) => loadNodeById(rows[0]!.id)),
        Effect.map(toNodeSnapshot),
      );

    const updateNode = (
      id: number,
      input: {
        actorId: string;
        expectedVersion: number;
        changesetId: number;
        geom: Point3D;
        featureType: string;
        tags: Record<string, string>;
      },
    ) =>
      ensureOpenChangeset(input.changesetId).pipe(
        Effect.zipRight(validateTags(input.tags)),
        Effect.zipRight(loadNodeById(id)),
        Effect.flatMap((current) =>
          ensureExpectedVersion("node", id, input.expectedVersion, current.version).pipe(
            Effect.zipRight(
              recordNodeVersion(current, input.changesetId).pipe(
                Effect.zipRight(
                  coreDb
                    .updateTable("nodes")
                    .set({
                      geom: makePointZ(input.geom),
                      feature_type: input.featureType,
                      tags: input.tags,
                      version: current.version + 1,
                      updated_at: new Date(),
                      updated_by: input.actorId,
                      changeset_id: input.changesetId,
                    })
                    .where("id", "=", id)
                    .pipe(runQuery, Effect.zipRight(loadNodeById(id)), Effect.map(toNodeSnapshot)),
                ),
              ),
            ),
          ),
        ),
      );

    const deleteNode = (
      id: number,
      input: {
        actorId: string;
        expectedVersion: number;
        changesetId: number;
      },
    ) =>
      ensureOpenChangeset(input.changesetId).pipe(
        Effect.zipRight(loadNodeById(id)),
        Effect.flatMap((current) =>
          ensureExpectedVersion("node", id, input.expectedVersion, current.version).pipe(
            Effect.zipRight(recordNodeVersion(current, input.changesetId)),
            Effect.zipRight(ensureNodeNotReferenced(id)),
            Effect.zipRight(
              coreDb
                .updateTable("nodes")
                .set({
                  deleted_at: new Date(),
                  updated_at: new Date(),
                  updated_by: input.actorId,
                  changeset_id: input.changesetId,
                  version: current.version + 1,
                })
                .where("id", "=", id)
                .pipe(runQuery, Effect.asVoid),
            ),
          ),
        ),
        Effect.asVoid,
      );

    const createWay = (input: {
      actorId: string;
      changesetId: number;
      featureType: string;
      geometryKind: GeometryKind;
      nodeRefs: ReadonlyArray<number>;
      tags: Record<string, string>;
    }) =>
      ensureOpenChangeset(input.changesetId).pipe(
        Effect.zipRight(validateTags(input.tags)),
        Effect.zipRight(validateWayNodeRefs(input.nodeRefs, input.geometryKind)),
        Effect.tap(() => ensureNodesExist(input.nodeRefs)),
        Effect.flatMap(({ isClosed }) =>
          coreDb
            .insertInto("ways")
            .values({
              feature_type: input.featureType,
              geometry_kind: input.geometryKind,
              is_closed: isClosed,
              tags: input.tags,
              version: 1,
              created_changeset_id: input.changesetId,
              created_at: new Date(),
              updated_at: new Date(),
              changeset_id: input.changesetId,
              created_by: input.actorId,
              updated_by: input.actorId,
            })
            .returning("id")
            .pipe(
              runQuery,
              Effect.flatMap((rows) => {
                const wayId = rows[0]!.id;

                return replaceWayNodes(wayId, input.nodeRefs, input.changesetId, 1).pipe(
                  Effect.zipRight(syncWayGeometry(wayId, input.geometryKind, 1)),
                  Effect.zipRight(loadWayById(wayId)),
                  Effect.map(toWaySnapshot),
                );
              }),
            ),
        ),
      );

    const updateWay = (
      id: number,
      input: {
        actorId: string;
        expectedVersion: number;
        changesetId: number;
        featureType: string;
        geometryKind: GeometryKind;
        nodeRefs: ReadonlyArray<number>;
        tags: Record<string, string>;
      },
    ) =>
      ensureOpenChangeset(input.changesetId).pipe(
        Effect.zipRight(validateTags(input.tags)),
        Effect.zipRight(validateWayNodeRefs(input.nodeRefs, input.geometryKind)),
        Effect.tap(() => ensureNodesExist(input.nodeRefs)),
        Effect.zipRight(loadWayById(id)),
        Effect.flatMap((current) =>
          ensureExpectedVersion("way", id, input.expectedVersion, current.version).pipe(
            Effect.zipRight(
              recordWayVersion(current, input.changesetId).pipe(
                Effect.zipRight(loadWayNodesByWayId(id)),
                Effect.flatMap((currentWayNodes) =>
                  recordWayNodeVersions(currentWayNodes, input.changesetId).pipe(
                    Effect.zipRight(
                      coreDb
                        .updateTable("ways")
                        .set({
                          feature_type: input.featureType,
                          geometry_kind: input.geometryKind,
                          is_closed:
                            input.nodeRefs[0] === input.nodeRefs[input.nodeRefs.length - 1],
                          tags: input.tags,
                          version: current.version + 1,
                          updated_at: new Date(),
                          updated_by: input.actorId,
                          changeset_id: input.changesetId,
                        })
                        .where("id", "=", id)
                        .pipe(
                          runQuery,
                          Effect.zipRight(
                            replaceWayNodes(
                              id,
                              input.nodeRefs,
                              input.changesetId,
                              current.version + 1,
                            ),
                          ),
                          Effect.zipRight(
                            syncWayGeometry(id, input.geometryKind, current.version + 1),
                          ),
                          Effect.zipRight(loadWayById(id)),
                          Effect.map(toWaySnapshot),
                        ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

    const deleteWay = (
      id: number,
      input: {
        actorId: string;
        expectedVersion: number;
        changesetId: number;
      },
    ) =>
      ensureOpenChangeset(input.changesetId).pipe(
        Effect.zipRight(loadWayById(id)),
        Effect.flatMap((current) =>
          ensureExpectedVersion("way", id, input.expectedVersion, current.version).pipe(
            Effect.zipRight(recordWayVersion(current, input.changesetId)),
            Effect.zipRight(loadWayNodesByWayId(id)),
            Effect.flatMap((currentWayNodes) =>
              recordWayNodeVersions(currentWayNodes, input.changesetId).pipe(
                Effect.zipRight(ensureWayNotReferenced(id)),
                Effect.zipRight(
                  coreDb
                    .updateTable("ways")
                    .set({
                      deleted_at: new Date(),
                      updated_at: new Date(),
                      updated_by: input.actorId,
                      changeset_id: input.changesetId,
                      version: current.version + 1,
                    })
                    .where("id", "=", id)
                    .pipe(runQuery, Effect.zipRight(deleteWayGeometry(id)), Effect.asVoid),
                ),
              ),
            ),
          ),
        ),
        Effect.asVoid,
      );

    const createRelation = (input: {
      actorId: string;
      changesetId: number;
      relationType: string;
      members: ReadonlyArray<RelationMemberInput>;
      tags: Record<string, string>;
    }) =>
      ensureOpenChangeset(input.changesetId).pipe(
        Effect.zipRight(validateTags(input.tags)),
        Effect.zipRight(ensureRelationMembersExist(input.members)),
        Effect.flatMap(() =>
          coreDb
            .insertInto("relations")
            .values({
              relation_type: input.relationType,
              tags: input.tags,
              version: 1,
              created_changeset_id: input.changesetId,
              created_at: new Date(),
              updated_at: new Date(),
              changeset_id: input.changesetId,
              created_by: input.actorId,
              updated_by: input.actorId,
            })
            .returning("id")
            .pipe(
              runQuery,
              Effect.flatMap((rows) => {
                const relationId = rows[0]!.id;

                return replaceRelationMembers(relationId, input.members, input.changesetId, 1).pipe(
                  Effect.zipRight(syncRelationGeometry(relationId, input.relationType, 1)),
                  Effect.zipRight(loadRelationById(relationId)),
                  Effect.map(toRelationSnapshot),
                );
              }),
            ),
        ),
      );

    const updateRelation = (
      id: number,
      input: {
        actorId: string;
        expectedVersion: number;
        changesetId: number;
        relationType: string;
        members: ReadonlyArray<RelationMemberInput>;
        tags: Record<string, string>;
      },
    ) =>
      ensureOpenChangeset(input.changesetId).pipe(
        Effect.zipRight(validateTags(input.tags)),
        Effect.zipRight(ensureRelationMembersExist(input.members, id)),
        Effect.zipRight(loadRelationById(id)),
        Effect.flatMap((current) =>
          ensureExpectedVersion("relation", id, input.expectedVersion, current.version).pipe(
            Effect.zipRight(
              recordRelationVersion(current, input.changesetId).pipe(
                Effect.zipRight(loadRelationMembersByRelationId(id)),
                Effect.flatMap((currentMembers) =>
                  recordRelationMemberVersions(currentMembers, input.changesetId).pipe(
                    Effect.zipRight(
                      coreDb
                        .updateTable("relations")
                        .set({
                          relation_type: input.relationType,
                          tags: input.tags,
                          version: current.version + 1,
                          updated_at: new Date(),
                          updated_by: input.actorId,
                          changeset_id: input.changesetId,
                        })
                        .where("id", "=", id)
                        .pipe(
                          runQuery,
                          Effect.zipRight(
                            replaceRelationMembers(
                              id,
                              input.members,
                              input.changesetId,
                              current.version + 1,
                            ),
                          ),
                          Effect.zipRight(
                            syncRelationGeometry(id, input.relationType, current.version + 1),
                          ),
                          Effect.zipRight(loadRelationById(id)),
                          Effect.map(toRelationSnapshot),
                        ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

    const deleteRelation = (
      id: number,
      input: {
        actorId: string;
        expectedVersion: number;
        changesetId: number;
      },
    ) =>
      ensureOpenChangeset(input.changesetId).pipe(
        Effect.zipRight(loadRelationById(id)),
        Effect.flatMap((current) =>
          ensureExpectedVersion("relation", id, input.expectedVersion, current.version).pipe(
            Effect.zipRight(recordRelationVersion(current, input.changesetId)),
            Effect.zipRight(loadRelationMembersByRelationId(id)),
            Effect.flatMap((currentMembers) =>
              recordRelationMemberVersions(currentMembers, input.changesetId).pipe(
                Effect.zipRight(ensureRelationNotReferenced(id)),
                Effect.zipRight(
                  coreDb
                    .updateTable("relations")
                    .set({
                      deleted_at: new Date(),
                      updated_at: new Date(),
                      updated_by: input.actorId,
                      changeset_id: input.changesetId,
                      version: current.version + 1,
                    })
                    .where("id", "=", id)
                    .pipe(runQuery, Effect.zipRight(deleteRelationGeometry(id)), Effect.asVoid),
                ),
              ),
            ),
          ),
        ),
        Effect.asVoid,
      );

    const loadViewport = (input: { bbox: BBox2D; includeRelations: boolean }) =>
      Effect.gen(function* () {
        const bbox: BBox2DInput = input.bbox;
        const publishedStatus = "published" as const;

        const wayIds = yield* derivedDb
          .selectFrom("way_geometries")
          .select("way_geometries.way_id")
          .where(intersectsBBox2D("bbox", bbox))
          .pipe(
            runQuery,
            Effect.map((rows) => rows.map((row) => row.way_id)),
          );

        const ways =
          wayIds.length === 0
            ? []
            : yield* coreDb
                .selectFrom("ways")
                .innerJoin("changesets", "changesets.id", "ways.changeset_id")
                .selectAll("ways")
                .where("ways.deleted_at", "is", null)
                .where("changesets.status", "=", publishedStatus)
                .where("ways.id", "in", wayIds)
                .pipe(runQuery);

        const wayNodes =
          wayIds.length === 0
            ? []
            : yield* coreDb
                .selectFrom("way_nodes")
                .selectAll()
                .where("way_id", "in", wayIds)
                .orderBy("way_id", "asc")
                .orderBy("seq", "asc")
                .pipe(runQuery);

        const viewportNodes = yield* coreDb
          .selectFrom("nodes")
          .innerJoin("changesets", "changesets.id", "nodes.changeset_id")
          .select([
            "nodes.id",
            "nodes.feature_type",
            "nodes.tags",
            "nodes.version",
            "nodes.created_at",
            "nodes.updated_at",
            "nodes.created_by",
            "nodes.updated_by",
            "nodes.deleted_at",
            "nodes.changeset_id",
            selectPointZJson("nodes.geom").as("geom_json"),
          ])
          .where("nodes.deleted_at", "is", null)
          .where("changesets.status", "=", publishedStatus)
          .where(intersectsBBox2D("nodes.geom", bbox))
          .pipe(runQuery);

        const nodeIds = new Set<number>([
          ...viewportNodes.map((row) => row.id),
          ...wayNodes.map((row) => row.node_id),
        ]);

        const missingNodeIds = [...nodeIds].filter(
          (id) => !viewportNodes.some((row) => row.id === id),
        );

        const attachedNodes =
          missingNodeIds.length === 0
            ? []
            : yield* coreDb
                .selectFrom("nodes")
                .innerJoin("changesets", "changesets.id", "nodes.changeset_id")
                .select([
                  "nodes.id",
                  "nodes.feature_type",
                  "nodes.tags",
                  "nodes.version",
                  "nodes.created_at",
                  "nodes.updated_at",
                  "nodes.created_by",
                  "nodes.updated_by",
                  "nodes.deleted_at",
                  "nodes.changeset_id",
                  selectPointZJson("nodes.geom").as("geom_json"),
                ])
                .where("nodes.deleted_at", "is", null)
                .where("changesets.status", "=", publishedStatus)
                .where("nodes.id", "in", missingNodeIds)
                .pipe(runQuery);

        const allNodes = [...viewportNodes, ...attachedNodes] as Array<NodeSelectRow>;
        const wayNodeIds = [...new Set(wayNodes.map((row) => row.node_id))];

        const relationMembers =
          !input.includeRelations || (wayIds.length === 0 && wayNodeIds.length === 0)
            ? []
            : yield* Effect.gen(function* () {
                const byWay =
                  wayIds.length === 0
                    ? []
                    : yield* coreDb
                        .selectFrom("relation_members")
                        .innerJoin("relations", "relations.id", "relation_members.relation_id")
                        .innerJoin("changesets", "changesets.id", "relations.changeset_id")
                        .selectAll("relation_members")
                        .where("relations.deleted_at", "is", null)
                        .where("changesets.status", "=", publishedStatus)
                        .where("relation_members.member_type", "=", "way")
                        .where("relation_members.member_id", "in", wayIds)
                        .pipe(runQuery);

                const byNode =
                  wayNodeIds.length === 0
                    ? []
                    : yield* coreDb
                        .selectFrom("relation_members")
                        .innerJoin("relations", "relations.id", "relation_members.relation_id")
                        .innerJoin("changesets", "changesets.id", "relations.changeset_id")
                        .selectAll("relation_members")
                        .where("relations.deleted_at", "is", null)
                        .where("changesets.status", "=", publishedStatus)
                        .where("relation_members.member_type", "=", "node")
                        .where("relation_members.member_id", "in", wayNodeIds)
                        .pipe(runQuery);

                const relationIds = [
                  ...new Set([...byWay, ...byNode].map((row) => row.relation_id)),
                ];

                if (relationIds.length === 0) {
                  return [] as Array<RelationMemberRow>;
                }

                return yield* coreDb
                  .selectFrom("relation_members")
                  .selectAll()
                  .where("relation_id", "in", relationIds)
                  .orderBy("relation_id", "asc")
                  .orderBy("seq", "asc")
                  .pipe(runQuery);
              });

        const relationIds = [...new Set(relationMembers.map((row) => row.relation_id))];

        const relations =
          relationIds.length === 0
            ? []
            : yield* coreDb
                .selectFrom("relations")
                .innerJoin("changesets", "changesets.id", "relations.changeset_id")
                .selectAll("relations")
                .where("relations.deleted_at", "is", null)
                .where("changesets.status", "=", publishedStatus)
                .where("relations.id", "in", relationIds)
                .pipe(runQuery);

        return new ViewportSnapshot({
          nodes: allNodes.map(toNodeSnapshot),
          ways: ways.map(toWaySnapshot),
          wayNodes: wayNodes.map(toWayNodeSnapshot),
          relations: relations.map(toRelationSnapshot),
          relationMembers: relationMembers.map(toRelationMemberSnapshot),
        });
      });

    return {
      createChangeset,
      publishChangeset,
      abandonChangeset,
      createNode,
      updateNode,
      deleteNode,
      createWay,
      updateWay,
      deleteWay,
      createRelation,
      updateRelation,
      deleteRelation,
      loadViewport,
    } satisfies GeospatialRepositoryService;
  }),
);
