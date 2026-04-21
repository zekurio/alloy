import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const url = process.env.DATABASE_URL
if (!url) {
  // eslint-disable-next-line no-console
  console.error("[db/migrate] DATABASE_URL is required")
  process.exit(1)
}

const client = postgres(url, { max: 1 })

try {
  await migrate(drizzle(client), {
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  })
} finally {
  await client.end()
}
