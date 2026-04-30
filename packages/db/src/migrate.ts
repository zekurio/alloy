import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { fileURLToPath } from "node:url"
import process from "node:process"
import postgres from "postgres"

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))

export async function migrateDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 })

  try {
    await client`select pg_advisory_lock(hashtext('alloy_migrations'))`
    try {
      await migrate(drizzle(client), {
        migrationsFolder,
      })
    } finally {
      await client`select pg_advisory_unlock(hashtext('alloy_migrations'))`
    }
  } finally {
    await client.end()
  }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    // eslint-disable-next-line no-console
    console.error("[db/migrate] DATABASE_URL is required")
    process.exit(1)
  }

  await migrateDatabase(url)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
