import { requiredSql } from "@alloy/server/db/sql"
import { eq, isNull, lt, or, type SQL, sql } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"

export const ENCODE_LEASE_STALE_INTERVAL = "2 minutes"
export const ENCODE_LEASE_STALE_MS = 2 * 60 * 1000

/**
 * Once a clip.encode job is claimed, the clip row is leasable when it is in an
 * encode-capable state and its clip-side lease is free or stale.
 */
export function encodeLeaseConditions(cols: {
  status: PgColumn
  encodeLockedAt: PgColumn
  encodeRunId: PgColumn
}): [SQL, SQL] {
  return [
    requiredSql(
      or(eq(cols.status, "processing"), eq(cols.status, "ready")),
      "encode lease status",
    ),
    requiredSql(
      or(
        isNull(cols.encodeRunId),
        lt(
          cols.encodeLockedAt,
          sql`now() - interval '${sql.raw(ENCODE_LEASE_STALE_INTERVAL)}'`,
        ),
      ),
      "encode lease freshness",
    ),
  ]
}
