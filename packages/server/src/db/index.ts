import { createDb } from "@alloy/db"
import { env } from "@alloy/server/env"
import { lazy } from "@alloy/server/runtime/lazy"

// A single long-lived pool — Hono runs in a single Node process. Built on first
// use rather than at import so that importing a module which touches the
// database does not itself open a connection.
let handle: ReturnType<typeof createDb> | undefined
const database = () => (handle ??= createDb(env.DATABASE_URL))

export const db = lazy(() => database().db)
export const client = lazy(() => database().client)

export async function warmDatabase(): Promise<void> {
  await client.query("select 1")
}
