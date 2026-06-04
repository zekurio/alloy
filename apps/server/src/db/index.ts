import { createDb } from "@workspace/db"

import { env } from "../env"

// A single long-lived pool — Hono runs in a single Node process.
export const { client, db } = createDb(env.DATABASE_URL)

export async function warmDatabase(): Promise<void> {
  await client`select 1`
}
