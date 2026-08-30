import { createLogger } from "@alloy/logging"
import { client } from "@alloy/server/db/index"
import { WakeableSerialWorker } from "@alloy/server/runtime/wakeable-serial-worker"

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

export interface AuthChallengeExpiryStore {
  deleteExpiredBatch(limit: number, signal: AbortSignal): Promise<number>
  selectNextExpiry(signal: AbortSignal): Promise<Date | null>
}

export interface AuthChallengeExpiryCoordinatorOptions {
  store: AuthChallengeExpiryStore
  batchSize?: number
  reconciliationIntervalMs?: number
  errorRetryMs?: number
  onError(cause: unknown): void
}

/** Direct, single-process coordinator for the auth challenge TTL index. */
export class AuthChallengeExpiryCoordinator {
  readonly #batchSize: number
  readonly #store: AuthChallengeExpiryStore
  readonly #worker: WakeableSerialWorker

  constructor(options: AuthChallengeExpiryCoordinatorOptions) {
    this.#batchSize = options.batchSize ?? DELETE_BATCH_SIZE
    this.#store = options.store
    this.#worker = new WakeableSerialWorker({
      reconciliationIntervalMs:
        options.reconciliationIntervalMs ?? RECONCILIATION_INTERVAL_MS,
      errorRetryMs: options.errorRetryMs ?? ERROR_RETRY_MS,
      runOne: (signal) => this.#runOne(signal),
      onError: options.onError,
    })
  }

  start(): void {
    this.#worker.start()
  }

  wake(): void {
    this.#worker.wake()
  }

  stop(): Promise<void> {
    return this.#worker.stop()
  }

  async #runOne(signal: AbortSignal) {
    if (signal.aborted) return { worked: false as const, nextRunAt: null }

    const deleted = await this.#store.deleteExpiredBatch(
      this.#batchSize,
      signal,
    )
    if (signal.aborted) return { worked: false as const, nextRunAt: null }
    if (deleted >= this.#batchSize) return { worked: true as const }

    const nextRunAt = await this.#store.selectNextExpiry(signal)
    return { worked: false as const, nextRunAt }
  }
}

const databaseStore: AuthChallengeExpiryStore = {
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

const coordinator = new AuthChallengeExpiryCoordinator({
  store: databaseStore,
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
