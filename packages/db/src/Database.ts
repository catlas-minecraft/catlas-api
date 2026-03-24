import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely"

export const RESERVED_TAG_KEYS = [
  "feature_type",
  "relation_type",
  "geometry_kind",
  "is_closed",
  "version",
  "deleted_at",
  "changeset_id"
] as const

export type TagMap = Record<string, string>

export type GeometryValue = unknown

type Timestamp = ColumnType<Date, Date | string, Date | string>
type JsonTags = ColumnType<TagMap, TagMap, TagMap>
type Geometry = ColumnType<GeometryValue, GeometryValue, GeometryValue>
type JsonSnapshot<T> = ColumnType<T, T, T>

export type ChangesetStatus = "open" | "published" | "abandoned"
export type GeometryKind = "line" | "area"
export type RelationMemberType = "node" | "way" | "relation"

export interface AuthSessionsTable {
  id: string
  secret_hash: Uint8Array
  user_id: string
  expires_at: Timestamp
  next_verified_at: Timestamp
  created_at: Timestamp
}

export interface ChangesetsTable {
  id: Generated<number>
  status: ChangesetStatus
  comment: string | null
  created_by: string
  created_at: Timestamp
  published_at: Timestamp | null
}

export interface NodesTable {
  id: Generated<number>
  mc_x: number
  mc_y: number
  mc_z: number
  geom_2d: ColumnType<GeometryValue, never, never>
  feature_type: string
  tags: JsonTags
  version: number
  created_changeset_id: number
  created_at: Timestamp
  updated_at: Timestamp
  created_by: string
  updated_by: string
  deleted_at: Timestamp | null
  changeset_id: number
}

export interface WaysTable {
  id: Generated<number>
  feature_type: string
  geometry_kind: GeometryKind
  is_closed: boolean
  tags: JsonTags
  version: number
  created_changeset_id: number
  created_at: Timestamp
  updated_at: Timestamp
  created_by: string
  updated_by: string
  deleted_at: Timestamp | null
  changeset_id: number
}

export interface WayNodesTable {
  id: Generated<number>
  way_id: number
  node_id: number
  seq: number
  version: number
  changeset_id: number
}

export interface RelationsTable {
  id: Generated<number>
  relation_type: string
  tags: JsonTags
  version: number
  created_changeset_id: number
  created_at: Timestamp
  updated_at: Timestamp
  created_by: string
  updated_by: string
  deleted_at: Timestamp | null
  changeset_id: number
}

export interface RelationMembersTable {
  id: Generated<number>
  relation_id: number
  member_type: RelationMemberType
  member_id: number
  seq: number
  role: string | null
  version: number
  changeset_id: number
}

export interface WayGeometriesTable {
  way_id: number
  geom: Geometry
  bbox: Geometry
  source_version: number
  refreshed_at: Timestamp
}

export interface RelationGeometriesTable {
  relation_id: number
  geom: Geometry
  bbox: Geometry
  source_version: number
  refreshed_at: Timestamp
}

interface VersionedEntitySnapshotBase {
  id: number
  version: number
  created_changeset_id: number
  created_at: string
  updated_at: string
  created_by: string
  updated_by: string
  deleted_at: string | null
  changeset_id: number
}

interface LegacyPoint3DJson {
  x: number
  y: number
  z: number
}

export type NodeVersionSnapshot =
  | (VersionedEntitySnapshotBase & {
      mc_x: number
      mc_y: number
      mc_z: number
      feature_type: string
      tags: TagMap
      geom_json?: never
    })
  | (VersionedEntitySnapshotBase & {
      feature_type: string
      tags: TagMap
      geom_json: LegacyPoint3DJson
      mc_x?: never
      mc_y?: never
      mc_z?: never
    })

export interface WayVersionSnapshot extends VersionedEntitySnapshotBase {
  feature_type: string
  geometry_kind: GeometryKind
  is_closed: boolean
  tags: TagMap
}

export interface WayNodeVersionSnapshot {
  id: number
  way_id: number
  node_id: number
  seq: number
  version: number
  changeset_id: number
}

export interface RelationVersionSnapshot extends VersionedEntitySnapshotBase {
  relation_type: string
  tags: TagMap
}

export interface RelationMemberVersionSnapshot {
  id: number
  relation_id: number
  member_type: RelationMemberType
  member_id: number
  seq: number
  role: string | null
  version: number
  changeset_id: number
}

export interface NodeVersionsTable {
  id: Generated<number>
  node_id: number
  version: number
  snapshot: JsonSnapshot<NodeVersionSnapshot>
  changeset_id: number
  recorded_at: Timestamp
}

export interface WayVersionsTable {
  id: Generated<number>
  way_id: number
  version: number
  snapshot: JsonSnapshot<WayVersionSnapshot>
  changeset_id: number
  recorded_at: Timestamp
}

export interface WayNodeVersionsTable {
  id: Generated<number>
  way_node_id: number
  version: number
  snapshot: JsonSnapshot<WayNodeVersionSnapshot>
  changeset_id: number
  recorded_at: Timestamp
}

export interface RelationVersionsTable {
  id: Generated<number>
  relation_id: number
  version: number
  snapshot: JsonSnapshot<RelationVersionSnapshot>
  changeset_id: number
  recorded_at: Timestamp
}

export interface RelationMemberVersionsTable {
  id: Generated<number>
  relation_member_id: number
  version: number
  snapshot: JsonSnapshot<RelationMemberVersionSnapshot>
  changeset_id: number
  recorded_at: Timestamp
}

export interface CatlasDatabase {
  sessions: AuthSessionsTable
  changesets: ChangesetsTable
  nodes: NodesTable
  ways: WaysTable
  way_nodes: WayNodesTable
  relations: RelationsTable
  relation_members: RelationMembersTable
  way_geometries: WayGeometriesTable
  relation_geometries: RelationGeometriesTable
  node_versions: NodeVersionsTable
  way_versions: WayVersionsTable
  way_node_versions: WayNodeVersionsTable
  relation_versions: RelationVersionsTable
  relation_member_versions: RelationMemberVersionsTable
}

export type AuthSessionRow = Selectable<AuthSessionsTable>
export type AuthSessionInsert = Insertable<AuthSessionsTable>
export type AuthSessionUpdate = Updateable<AuthSessionsTable>
export type ChangeSetRow = Selectable<ChangesetsTable>
export type ChangeSetInsert = Insertable<ChangesetsTable>
export type ChangeSetUpdate = Updateable<ChangesetsTable>
export type NodeRow = Selectable<NodesTable>
export type NodeInsert = Insertable<NodesTable>
export type NodeUpdate = Updateable<NodesTable>
export type WayRow = Selectable<WaysTable>
export type WayInsert = Insertable<WaysTable>
export type WayUpdate = Updateable<WaysTable>
export type WayNodeRow = Selectable<WayNodesTable>
export type WayNodeInsert = Insertable<WayNodesTable>
export type WayNodeUpdate = Updateable<WayNodesTable>
export type RelationRow = Selectable<RelationsTable>
export type RelationInsert = Insertable<RelationsTable>
export type RelationUpdate = Updateable<RelationsTable>
export type RelationMemberRow = Selectable<RelationMembersTable>
export type RelationMemberInsert = Insertable<RelationMembersTable>
export type RelationMemberUpdate = Updateable<RelationMembersTable>
export type WayGeometryRow = Selectable<WayGeometriesTable>
export type RelationGeometryRow = Selectable<RelationGeometriesTable>
