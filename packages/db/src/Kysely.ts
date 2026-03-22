import * as PgKysely from "@effect/sql-kysely/Pg"
import type { EffectKysely } from "@effect/sql-kysely/Pg"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import { types } from "pg"
import type { CatlasDatabase } from "./Database.js"

types.setTypeParser(20, (value) => Number(value))

export const CORE_SCHEMA = "core"
export const AUTH_SCHEMA = "auth"
export const HISTORY_SCHEMA = "history"
export const DERIVED_SCHEMA = "derived"

export const CatlasKysely = Context.GenericTag<EffectKysely<CatlasDatabase>>(
  "@catlas/db/CatlasKysely"
)

export const makeDatabaseLayer = (config: PgClient.PgClientConfig) => {
  const sqlLayer = PgClient.layer(config)

  const kyselyLayer = Layer.effect(CatlasKysely, PgKysely.make<CatlasDatabase>({})).pipe(
    Layer.provide(sqlLayer)
  )

  return Layer.merge(sqlLayer, kyselyLayer)
}

export const databaseConfig = {
  url: Config.redacted("DATABASE_URL")
}

export const makeDatabaseLayerFromConfig = (
  config: Config.Config.Wrap<PgClient.PgClientConfig> = databaseConfig
) => {
  const sqlLayer = PgClient.layerConfig(config)

  const kyselyLayer = Layer.effect(CatlasKysely, PgKysely.make<CatlasDatabase>({})).pipe(
    Layer.provide(sqlLayer)
  )

  return Layer.merge(sqlLayer, kyselyLayer)
}

const withSchema = (db: EffectKysely<CatlasDatabase>, schema: string) =>
  db.withSchema(schema) as unknown as EffectKysely<CatlasDatabase>

export const withCoreSchema = (db: EffectKysely<CatlasDatabase>) => withSchema(db, CORE_SCHEMA)
export const withAuthSchema = (db: EffectKysely<CatlasDatabase>) => withSchema(db, AUTH_SCHEMA)
export const withHistorySchema = (db: EffectKysely<CatlasDatabase>) => withSchema(db, HISTORY_SCHEMA)
export const withDerivedSchema = (db: EffectKysely<CatlasDatabase>) => withSchema(db, DERIVED_SCHEMA)
