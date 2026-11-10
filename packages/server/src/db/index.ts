import { createDb } from "@alloy/db"
import { env } from "@alloy/server/env"

// A single long-lived pool: Hono runs in a single Node process. The pool
// opens its first connection on the first query.
export const { db, client } = createDb(env.DATABASE_URL)

export async function warmDatabase(): Promise<void> {
  await client.query("select 1")
}
