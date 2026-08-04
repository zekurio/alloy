import { fileURLToPath, pathToFileURL } from "node:url"

import { logger } from "@alloy/logging"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"

import { createPostgresPool } from "./connection.ts"

const migrationsFolder =
  process.env.ALLOY_MIGRATIONS_DIR ??
  fileURLToPath(new URL("../../drizzle", import.meta.url))

export async function migrateDatabase(databaseUrl: string) {
  const client = createPostgresPool(databaseUrl, { max: 1 })

  try {
    await client.query("select pg_advisory_lock(hashtext('alloy_migrations'))")
    try {
      await assertCurrentMigrationHistory(client)
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

async function assertCurrentMigrationHistory(
  client: ReturnType<typeof createPostgresPool>,
): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder })
  if (migrations.length !== 1 || !migrations[0]) {
    throw new Error("Alloy 1.0 requires exactly one baseline migration")
  }

  const table = await client.query<{ migration_table: string | null }>(
    "select to_regclass('drizzle.__drizzle_migrations')::text as migration_table",
  )
  if (!table.rows[0]?.migration_table) {
    const existing = await client.query<{ alloy_table: string | null }>(
      "select coalesce(to_regclass('public.clip'), to_regclass('public.user'))::text as alloy_table",
    )
    if (!existing.rows[0]?.alloy_table) return
    throw freshDatabaseRequired()
  }

  const applied = await client.query<{ hash: string; created_at: string }>(
    "select hash, created_at::text from drizzle.__drizzle_migrations order by created_at",
  )
  if (applied.rows.length === 0) return
  if (
    applied.rows.length === 1 &&
    applied.rows[0]?.hash === migrations[0].hash &&
    Number(applied.rows[0].created_at) === migrations[0].folderMillis
  ) {
    return
  }

  throw freshDatabaseRequired()
}

function freshDatabaseRequired(): Error {
  return new Error(
    "This database predates the Alloy 1.0 baseline. Provision a fresh database; in-place migration is not supported.",
  )
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    logger.error("[db/migrate] DATABASE_URL is required")
    process.exit(1)
  }

  await migrateDatabase(url)
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main()
}
