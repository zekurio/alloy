import { createLogger } from "@alloy/logging"
import { client } from "@alloy/server/db/index"
import {
  createExpiryWorker,
  type ExpiryStore,
} from "@alloy/server/runtime/wakeable-serial-worker"

const logger = createLogger("auth-session-expiry")

const DELETE_BATCH_SIZE = 500
// Lookups already ignore expired sessions, so pruning only bounds table
// growth. A new session's deadline is 90 days out, never earlier than one the
// worker already waits for, so sign-in does not need to wake it.
const RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000
const ERROR_RETRY_MS = 5_000

// auth_session predates the repository's timestamptz convention. Interpret
// its timestamp-without-time-zone values as UTC at both SQL boundaries so
// process and database host offsets cannot shift the worker deadline.
export const AUTH_SESSION_EXPIRY_DELETE_SQL = `
  with doomed as (
    select id
    from auth_session
    where expires_at <= (now() at time zone 'UTC')
    order by expires_at, id
    limit $1
  )
  delete from auth_session
  using doomed
  where auth_session.id = doomed.id
  returning auth_session.id
`

export const AUTH_SESSION_EXPIRY_NEXT_SQL = `
  select min(expires_at) at time zone 'UTC' as "nextRunAt"
  from auth_session
`

const databaseStore: ExpiryStore = {
  async deleteExpiredBatch(limit) {
    const result = await client.query<{ id: string }>(
      AUTH_SESSION_EXPIRY_DELETE_SQL,
      [limit],
    )
    return result.rowCount ?? result.rows.length
  },
  async selectNextExpiry() {
    const result = await client.query<{ nextRunAt: Date | null }>(
      AUTH_SESSION_EXPIRY_NEXT_SQL,
    )
    return result.rows[0]?.nextRunAt ?? null
  },
}

const coordinator = createExpiryWorker({
  store: databaseStore,
  batchSize: DELETE_BATCH_SIZE,
  reconciliationIntervalMs: RECONCILIATION_INTERVAL_MS,
  errorRetryMs: ERROR_RETRY_MS,
  onError: (cause) =>
    logger.error("auth session expiry coordinator failed:", cause),
})

export function startAuthSessionExpiryWorker(): void {
  coordinator.start()
}

export function stopAuthSessionExpiryWorker(): Promise<void> {
  return coordinator.stop()
}
