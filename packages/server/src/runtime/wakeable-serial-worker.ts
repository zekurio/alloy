export interface WakeableSerialWorkerOptions {
  /** Upper bound for reconciliation scans when durable work is empty. */
  reconciliationIntervalMs: number
  /** Short fallback after a coordinator/store failure. */
  errorRetryMs?: number
  runOne(signal: AbortSignal): Promise<WakeableRunResult>
  onError(cause: unknown): void
}

export type WakeableRunResult =
  | { worked: true }
  | { worked: false; nextRunAt: Date | null }

/**
 * Adaptive serial coordinator for database-backed work.
 *
 * The database row owns durability; this class only removes polling latency.
 * A wake that races an active drain is remembered and schedules another pass
 * immediately after it, while the periodic poll covers process restarts and
 * wakeups lost between a committing process and this one.
 */
export class WakeableSerialWorker {
  private timer: ReturnType<typeof setTimeout> | null = null
  private timerAt = 0
  private pumpPromise: Promise<void> | null = null
  private activeAbort: AbortController | null = null
  private wakeAfterPump = false
  private started = false
  private stopping = false

  constructor(private readonly options: WakeableSerialWorkerOptions) {}

  start(): void {
    if (this.started) return
    this.started = true
    this.stopping = false
    this.schedulePump(0)
  }

  wake(): void {
    if (!this.started || this.stopping) return
    if (this.pumpPromise) {
      this.wakeAfterPump = true
      return
    }
    this.schedulePump(0)
  }

  async stop(): Promise<void> {
    if (!this.started && !this.pumpPromise) return
    this.started = false
    this.stopping = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.timerAt = 0
    this.activeAbort?.abort("shutdown")
    await this.pumpPromise
    this.stopping = false
  }

  private schedulePump(delayMs: number): void {
    if (!this.started || this.stopping) return
    if (this.pumpPromise) {
      if (delayMs === 0) this.wakeAfterPump = true
      return
    }

    const runAt = Date.now() + delayMs
    if (this.timer && this.timerAt <= runAt) return
    if (this.timer) clearTimeout(this.timer)
    this.timerAt = runAt
    this.timer = setTimeout(() => {
      this.timer = null
      this.timerAt = 0
      this.pump()
    }, delayMs)
    this.timer.unref()
  }

  private pump(): void {
    if (!this.started || this.stopping || this.pumpPromise) return
    const abort = new AbortController()
    this.activeAbort = abort
    this.wakeAfterPump = false
    let nextRunAt: Date | null = null
    let failed = false

    const pump = this.drain(abort.signal)
      .catch((cause: unknown) => {
        failed = true
        this.options.onError(cause)
        return null
      })
      .then((deadline) => {
        nextRunAt = deadline
      })
      .finally(() => {
        this.pumpPromise = null
        this.activeAbort = null
        if (!this.started || this.stopping) return
        const delay = this.wakeAfterPump
          ? 0
          : failed
            ? (this.options.errorRetryMs ??
              this.options.reconciliationIntervalMs)
            : this.nextDelay(nextRunAt, Date.now())
        this.wakeAfterPump = false
        this.schedulePump(delay)
      })
    this.pumpPromise = pump
  }

  private async drain(signal: AbortSignal): Promise<Date | null> {
    while (this.started && !signal.aborted) {
      const result = await this.options.runOne(signal)
      if (!result.worked) return result.nextRunAt
    }
    return null
  }

  private nextDelay(nextRunAt: Date | null, now: number): number {
    if (!nextRunAt) return this.options.reconciliationIntervalMs
    return Math.min(
      this.options.reconciliationIntervalMs,
      Math.max(0, nextRunAt.getTime() - now),
    )
  }
}

export interface ExpiryStore {
  deleteExpiredBatch(limit: number, signal: AbortSignal): Promise<number>
  selectNextExpiry(signal: AbortSignal): Promise<Date | null>
}

export function createExpiryWorker({
  store,
  batchSize,
  ...options
}: Omit<WakeableSerialWorkerOptions, "runOne"> & {
  store: ExpiryStore
  batchSize: number
}): WakeableSerialWorker {
  return new WakeableSerialWorker({
    ...options,
    async runOne(signal) {
      if (signal.aborted) return { worked: false, nextRunAt: null }

      const deleted = await store.deleteExpiredBatch(batchSize, signal)
      if (signal.aborted) return { worked: false, nextRunAt: null }
      if (deleted >= batchSize) return { worked: true }

      return {
        worked: false,
        nextRunAt: await store.selectNextExpiry(signal),
      }
    },
  })
}
