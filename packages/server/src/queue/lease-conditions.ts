import { requiredSql } from "@alloy/server/db/sql"
import { and, eq, isNull, lt, or, type SQL, sql } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"

export const ENCODE_LEASE_STALE_INTERVAL = "2 minutes"
export const RETRY_DELAY_INTERVAL = "30 seconds"

/**
 * A row is leasable when it is mid-processing (or a ready row whose derived
 * assets never finished) AND its lease is free or stale. Shared by every media
 * store via column refs so the SQL lives in one place.
 */
export function encodeLeaseConditions(cols: {
  status: PgColumn
  encodeProgress: PgColumn
  encodeLockedAt: PgColumn
}): [SQL, SQL] {
  return [
    requiredSql(
      or(
        eq(cols.status, "processing"),
        and(eq(cols.status, "ready"), lt(cols.encodeProgress, 100)),
      ),
      "encode lease status",
    ),
    requiredSql(
      or(
        isNull(cols.encodeLockedAt),
        lt(
          cols.encodeLockedAt,
          sql`now() - interval '${sql.raw(ENCODE_LEASE_STALE_INTERVAL)}'`,
        ),
      ),
      "encode lease freshness",
    ),
  ]
}
