import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const migrationsFolder =
  Deno.env.get("ALLOY_MIGRATIONS_DIR") ??
  new URL("../drizzle", import.meta.url).pathname

export async function migrateDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 1,
  })

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
  const url = Deno.env.get("DATABASE_URL")
  if (!url) {
    // eslint-disable-next-line no-console
    console.error("[db/migrate] DATABASE_URL is required")
    Deno.exit(1)
  }

  await migrateDatabase(url)
}

if (Deno.mainModule === import.meta.url) {
  await main()
}
