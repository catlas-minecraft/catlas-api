import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { Client } from "pg"
import { migrationsDirectory } from "../src/Migrations.js"

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://catlas:catlas@127.0.0.1:5432/catlas"

const client = new Client({
  connectionString
})

const main = async () => {
  const entries = await readdir(migrationsDirectory)
  const migrationFiles = entries.filter((entry) => entry.endsWith(".sql")).sort()

  await client.connect()

  try {
    for (const migrationFile of migrationFiles) {
      const sql = await readFile(join(migrationsDirectory, migrationFile), "utf8")
      process.stdout.write(`applying ${migrationFile}\n`)
      await client.query("begin")
      try {
        await client.query(sql)
        await client.query("commit")
      } catch (error) {
        await client.query("rollback")
        throw error
      }
    }
  } finally {
    await client.end()
  }
}

await main()
