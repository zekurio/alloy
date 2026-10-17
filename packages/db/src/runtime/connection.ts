import { logger } from "@alloy/logging"
import { Pool } from "pg"

type CreatePostgresPoolOptions = {
  max?: number
  /** Start sessions in UTC. On by default; see {@link withUtcSessions}. */
  utcSessions?: boolean
}

const DEFAULT_POOL_MAX = 10
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
const UTC_SESSION_OPTION = "-c TimeZone=UTC"

/**
 * Drizzle writes and reads `timestamp` columns as UTC wall time, but `now()`,
 * column defaults, and casts to `timestamptz` follow the session time zone.
 * Start every session in UTC so a server with another TimeZone setting cannot
 * shift timestamps. This goes in the URL because pg lets connection string
 * parameters override its config, and it comes after any options already
 * there so it wins over a TimeZone set in them.
 */
function withUtcSessions(databaseUrl: string): string {
  // Env validation already requires a URL. Refuse anything else rather than
  // run with sessions in the server's local time.
  if (!URL.canParse(databaseUrl)) {
    throw new Error(
      "DATABASE_URL must be a postgres:// URL so sessions can start in UTC.",
    )
  }
  const url = new URL(databaseUrl)
  const options = url.searchParams.get("options")
  url.searchParams.set(
    "options",
    options ? `${options} ${UTC_SESSION_OPTION}` : UTC_SESSION_OPTION,
  )
  return url.toString()
}

export function createPostgresPool(
  databaseUrl: string,
  options: CreatePostgresPoolOptions = {},
): Pool {
  const pool = new Pool({
    connectionString:
      options.utcSessions === false
        ? databaseUrl
        : withUtcSessions(databaseUrl),
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
