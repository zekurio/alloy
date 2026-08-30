import { createLogger } from "@alloy/logging"
import { client } from "@alloy/server/db/index"
import { WakeableSerialWorker } from "@alloy/server/runtime/wakeable-serial-worker"

const logger = createLogger("notification-expiry")

const DELETE_BATCH_SIZE = 1000
const RECONCILIATION_INTERVAL_MS = 10 * 60 * 1000
const ERROR_RETRY_MS = 5_000

/**
 * Read and unread notifications have different creation-time TTLs. Select a
 * bounded candidate set from each partial index, then delete the globally
 * earliest deadlines. The outer limit keeps one pass bounded even when both
 * partitions contain due rows.
 */
export const NOTIFICATION_EXPIRY_DELETE_SQL = `
  with candidates as (
    (
      select id, created_at + interval '30 days' as expires_at
      from notification
      where read_at is not null
        and created_at <= now() - interval '30 days'
      order by created_at, id
      limit $1
    )
    union all
    (
      select id, created_at + interval '90 days' as expires_at
      from notification
      where read_at is null
        and created_at <= now() - interval '90 days'
      order by created_at, id
      limit $1
    )
  ),
  doomed as (
    select id
    from candidates
    order by expires_at, id
    limit $1
  )
  delete from notification
  using doomed
  where notification.id = doomed.id
  returning notification.id
`

/** Return the exact first persisted deadline from the same two indexes. */
export const NOTIFICATION_EXPIRY_NEXT_SQL = `
  select min(expires_at) as "nextRunAt"
  from (
    (
      select created_at + interval '30 days' as expires_at
      from notification
      where read_at is not null
      order by created_at, id
      limit 1
    )
    union all
    (
      select created_at + interval '90 days' as expires_at
      from notification
      where read_at is null
      order by created_at, id
      limit 1
    )
  ) deadlines
`

export interface NotificationExpiryStore {
  deleteExpiredBatch(limit: number, signal: AbortSignal): Promise<number>
  selectNextExpiry(signal: AbortSignal): Promise<Date | null>
}

export interface NotificationExpiryCoordinatorOptions {
  store: NotificationExpiryStore
  batchSize?: number
  reconciliationIntervalMs?: number
  errorRetryMs?: number
  onError(cause: unknown): void
}

/** Direct, single-process coordinator for persisted notification deadlines. */
export class NotificationExpiryCoordinator {
  readonly #batchSize: number
  readonly #store: NotificationExpiryStore
  readonly #worker: WakeableSerialWorker

  constructor(options: NotificationExpiryCoordinatorOptions) {
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

const databaseStore: NotificationExpiryStore = {
  async deleteExpiredBatch(limit) {
    const result = await client.query<{ id: string }>(
      NOTIFICATION_EXPIRY_DELETE_SQL,
      [limit],
    )
    const deleted = result.rowCount ?? result.rows.length
    if (deleted > 0) logger.info(`pruned expired notifications=${deleted}`)
    return deleted
  },
  async selectNextExpiry() {
    const result = await client.query<{ nextRunAt: Date | null }>(
      NOTIFICATION_EXPIRY_NEXT_SQL,
    )
    return result.rows[0]?.nextRunAt ?? null
  },
}

const coordinator = new NotificationExpiryCoordinator({
  store: databaseStore,
  onError: (cause) =>
    logger.error("notification expiry coordinator failed:", cause),
})

export function startNotificationExpiryWorker(): void {
  coordinator.start()
}

export function wakeNotificationExpiryWorker(): void {
  coordinator.wake()
}

export function stopNotificationExpiryWorker(): Promise<void> {
  return coordinator.stop()
}

/** Wake only when INSERT ... RETURNING confirms that a row was committed. */
export async function insertNotificationAndWake<T>(
  insert: () => Promise<T | null>,
  wake: () => void = wakeNotificationExpiryWorker,
): Promise<T | null> {
  const result = await insert()
  if (result !== null) wake()
  return result
}

/**
 * Wake only after the database mutation succeeds. A wake racing an active
 * pass is remembered by WakeableSerialWorker; reconciliation covers process
 * restarts and any write path outside this process.
 */
export async function mutateNotificationsAndWake<
  T extends { rowCount: number | null },
>(
  mutate: () => Promise<T>,
  wake: () => void = wakeNotificationExpiryWorker,
): Promise<T> {
  const result = await mutate()
  if ((result.rowCount ?? 0) > 0) wake()
  return result
}
