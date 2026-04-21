import { createDb, type Db } from "@workspace/db"

import { env } from "../env"

// A single long-lived pool — Hono runs in a single Node process.
export const { db } = createDb(env.DATABASE_URL)
export type { Db }
