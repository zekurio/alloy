import { createLogger } from "@alloy/logging"
import { client } from "@alloy/server/db/index"
import {
  createExpiryWorker,
  type WakeableSerialWorker,
} from "@alloy/server/runtime/wakeable-serial-worker"

const DELETE_BATCH_SIZE = 500
const ERROR_RETRY_MS = 5_000

/** Deletes an auth table's expired rows in batches. */
export function createAuthExpiryWorker(input: {
  table: "auth_challenge" | "auth_session"
  reconciliationIntervalMs: number
}): WakeableSerialWorker {
  const { table } = input
  const logger = createLogger(`${table.replaceAll("_", "-")}-expiry`)

  // Both tables predate the repository's timestamptz convention. Interpret
  // their timestamp-without-time-zone values as UTC at both SQL boundaries so
  // process and database host offsets cannot shift the worker deadline.
  const deleteSql = `
    with doomed as (
      select id
      from ${table}
      where expires_at <= (now() at time zone 'UTC')
      order by expires_at, id
      limit $1
    )
    delete from ${table}
    using doomed
    where ${table}.id = doomed.id
    returning ${table}.id
  `
  const nextSql = `
    select min(expires_at) at time zone 'UTC' as "nextRunAt"
    from ${table}
  `

  return createExpiryWorker({
    store: {
      async deleteExpiredBatch(limit) {
        const result = await client.query<{ id: string }>(deleteSql, [limit])
        return result.rowCount ?? result.rows.length
      },
      async selectNextExpiry() {
        const result = await client.query<{ nextRunAt: Date | null }>(nextSql)
        return result.rows[0]?.nextRunAt ?? null
      },
    },
    batchSize: DELETE_BATCH_SIZE,
    reconciliationIntervalMs: input.reconciliationIntervalMs,
    errorRetryMs: ERROR_RETRY_MS,
    onError: (cause) =>
      logger.error(
        `${table.replaceAll("_", " ")} expiry coordinator failed:`,
        cause,
      ),
  })
}
