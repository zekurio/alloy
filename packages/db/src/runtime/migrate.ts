import { fileURLToPath } from "node:url"

import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"

import { createPostgresPool } from "./connection"

const migrationsFolder =
  process.env.ALLOY_MIGRATIONS_DIR ??
  fileURLToPath(new URL("../../drizzle", import.meta.url))

export async function migrateDatabase(databaseUrl: string) {
  const client = createPostgresPool(databaseUrl, { max: 1 })

  try {
    await client.query("select pg_advisory_lock(hashtext('alloy_migrations'))")
    try {
      await migrate(drizzle(client), {
        migrationsFolder,
      })
    } finally {
      await client.query(
        "select pg_advisory_unlock(hashtext('alloy_migrations'))",
      )
    }
  } finally {
    await client.end()
  }
}
