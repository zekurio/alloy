import { pathToFileURL } from "node:url"

import { logger } from "alloy-logging"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"

import { createPostgresPool } from "./connection.ts"

const migrationsFolder =
  process.env.ALLOY_MIGRATIONS_DIR ??
  new URL("../drizzle", import.meta.url).pathname

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

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    logger.error("[db/migrate] DATABASE_URL is required")
    process.exit(1)
    return
  }

  await migrateDatabase(url)
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main()
}
