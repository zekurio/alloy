import { createDb } from "@alloy/db"
import { env } from "@alloy/server/env"
import { lazy } from "@alloy/server/runtime/lazy"

// A single long-lived pool — Hono runs in a single Node process. Built on first
// use rather than at import so that importing a module which touches the
// database does not itself open a connection.
const handle = lazy(() => createDb(env.DATABASE_URL))

export const db = lazy(() => handle.db)
export const client = lazy(() => handle.client)

export async function warmDatabase(): Promise<void> {
  await client.query("select 1")
}
