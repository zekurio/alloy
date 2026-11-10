import { logger } from "@alloy/logging"
import { Pool } from "pg"

type CreatePostgresPoolOptions = {
  max?: number
}

const DEFAULT_POOL_MAX = 10
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
const UTC_SESSION_OPTION = "-c TimeZone=UTC"

/**
 * Every timestamp column is `timestamptz`, so stored instants do not depend on
 * the session time zone, but their text form does. Drizzle and pg parse that
 * text with JS `Date`, which cannot read the seconds-precision offsets
 * PostgreSQL prints for historical dates in many zones (`-04:56:02`), and
 * `::text` values such as cursors and revisions should not change with the
 * database's TimeZone. Start every session in UTC so that text always ends in
 * `+00`. This goes in the URL because pg lets connection string parameters
 * override its config, and it comes after any options already there so it
 * wins over a TimeZone set in them.
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
    connectionString: withUtcSessions(databaseUrl),
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
