import { logger } from "@alloy/logging"
import { Pool } from "pg"

type CreatePostgresPoolOptions = {
  max?: number
}

const DEFAULT_POOL_MAX = 10
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000

export function createPostgresPool(
  databaseUrl: string,
  options: CreatePostgresPoolOptions = {},
): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: DEFAULT_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 0,
    max: options.max ?? DEFAULT_POOL_MAX,
  })
  // pg removes failed idle clients; handle the event so the process survives.
  pool.on("error", (error) => {
    logger.error("[db] Idle connection failed", error)
  })
  return pool
}
