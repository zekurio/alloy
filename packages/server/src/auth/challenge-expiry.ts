import { createLogger } from "@alloy/logging"
import { client } from "@alloy/server/db/index"
import {
  createExpiryWorker,
  type ExpiryStore,
} from "@alloy/server/runtime/wakeable-serial-worker"

const logger = createLogger("auth-challenge-expiry")

const DELETE_BATCH_SIZE = 500
const RECONCILIATION_INTERVAL_MS = 10 * 60 * 1000
const ERROR_RETRY_MS = 5_000

// auth_challenge predates the repository's timestamptz convention. Interpret
// its timestamp-without-time-zone values as UTC at both SQL boundaries so
// process and database host offsets cannot shift the worker deadline.
export const AUTH_CHALLENGE_EXPIRY_DELETE_SQL = `
  with doomed as (
    select id
    from auth_challenge
    where expires_at <= (now() at time zone 'UTC')
    order by expires_at, id
    limit $1
  )
  delete from auth_challenge
  using doomed
  where auth_challenge.id = doomed.id
  returning auth_challenge.id
`

export const AUTH_CHALLENGE_EXPIRY_NEXT_SQL = `
  select min(expires_at) at time zone 'UTC' as "nextRunAt"
  from auth_challenge
`

const databaseStore: ExpiryStore = {
  async deleteExpiredBatch(limit) {
    const result = await client.query<{ id: string }>(
      AUTH_CHALLENGE_EXPIRY_DELETE_SQL,
      [limit],
    )
    return result.rowCount ?? result.rows.length
  },
  async selectNextExpiry() {
    const result = await client.query<{ nextRunAt: Date | null }>(
      AUTH_CHALLENGE_EXPIRY_NEXT_SQL,
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
    logger.error("auth challenge expiry coordinator failed:", cause),
})

export function startAuthChallengeExpiryWorker(): void {
  coordinator.start()
}

export function wakeAuthChallengeExpiryWorker(): void {
  coordinator.wake()
}

export function stopAuthChallengeExpiryWorker(): Promise<void> {
  return coordinator.stop()
}

/**
 * Tie the low-latency wake to a successful autocommit insert. Startup and the
 * periodic reconciliation pass recover inserts made before worker startup.
 */
export async function insertAuthChallengeAndWake<T>(
  insert: () => Promise<T>,
  wake: () => void = wakeAuthChallengeExpiryWorker,
): Promise<T> {
  const result = await insert()
  wake()
  return result
}
