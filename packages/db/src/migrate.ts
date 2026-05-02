import { SQL } from "bun"
import { drizzle } from "drizzle-orm/bun-sql"
import { migrate } from "drizzle-orm/bun-sql/migrator"
import { fileURLToPath } from "node:url"
import process from "node:process"

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))

export async function migrateDatabase(databaseUrl: string) {
  const client = new SQL({ url: databaseUrl, max: 1 })

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
    await client.close()
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
