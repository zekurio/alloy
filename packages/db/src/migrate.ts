import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { logger } from "@workspace/logging"

import { createPostgresPool } from "./connection.ts"

const migrationsFolder = Deno.env.get("ALLOY_MIGRATIONS_DIR") ??
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
  const url = Deno.env.get("DATABASE_URL")
  if (!url) {
    logger.error("[db/migrate] DATABASE_URL is required")
    Deno.exit(1)
    return
  }

  await migrateDatabase(url)
}

if (Deno.mainModule === import.meta.url) {
  await main()
}
