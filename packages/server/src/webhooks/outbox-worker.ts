export interface OutboxWorkerOptions {
  /** Upper bound for reconciliation scans when the outbox is empty. */
  pollIntervalMs: number
  runOne(signal: AbortSignal): Promise<OutboxRunResult>
  onError(cause: unknown): void
}

export type OutboxRunResult =
  | { worked: true }
  | { worked: false; nextRunAt: Date | null }

/**
 * Wakeable, serial worker for a database-backed outbox.
 *
 * The database row owns durability; this class only removes polling latency.
 * A wake that races an active drain is remembered and schedules another pass
 * immediately after it, while the periodic poll covers process restarts and
 * wakeups lost between a committing process and this one.
 */
export class OutboxWorker {
  private timer: ReturnType<typeof setTimeout> | null = null
  private timerAt = 0
  private pumpPromise: Promise<void> | null = null
  private activeAbort: AbortController | null = null
  private wakeAfterPump = false
  private started = false
  private stopping = false

  constructor(private readonly options: OutboxWorkerOptions) {}

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

    const pump = this.drain(abort.signal)
      .catch((cause: unknown) => {
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
    if (!nextRunAt) return this.options.pollIntervalMs
    return Math.min(
      this.options.pollIntervalMs,
      Math.max(0, nextRunAt.getTime() - now),
    )
  }
}
