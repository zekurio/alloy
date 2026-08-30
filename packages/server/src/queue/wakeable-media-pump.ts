export interface WakeableMediaPumpOptions {
  /** Upper bound for reconciliation scans when there is no persisted retry. */
  reconciliationIntervalMs: number
  /** Short fallback after a database or claim failure. */
  errorRetryMs: number
  runPass(): Promise<Date | null>
  onError(cause: unknown): void
}

/**
 * Wakeable scheduler for the direct media worker.
 *
 * Durable work and retry times live on clip rows. A wake only removes latency,
 * so a wake racing an active pass must be remembered until that pass finishes.
 */
export class WakeableMediaPump {
  private timer: ReturnType<typeof setTimeout> | null = null
  private timerAt = 0
  private pumpPromise: Promise<void> | null = null
  private wakeAfterPump = false
  private started = false
  private stopping = false

  constructor(private readonly options: WakeableMediaPumpOptions) {}

  start(): void {
    if (this.started) return
    this.started = true
    this.stopping = false
    this.schedule(0)
  }

  wake(): void {
    if (!this.started || this.stopping) return
    if (this.pumpPromise) {
      this.wakeAfterPump = true
      return
    }
    this.schedule(0)
  }

  async stop(): Promise<void> {
    if (!this.started && !this.pumpPromise) return
    this.started = false
    this.stopping = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.timerAt = 0
    await this.pumpPromise
    this.stopping = false
  }

  private schedule(delayMs: number): void {
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
    this.wakeAfterPump = false
    let nextRunAt: Date | null = null
    let failed = false

    const pump = this.options
      .runPass()
      .then((deadline) => {
        nextRunAt = deadline
      })
      .catch((cause: unknown) => {
        failed = true
        this.options.onError(cause)
      })
      .finally(() => {
        this.pumpPromise = null
        if (!this.started || this.stopping) return
        const delay = this.wakeAfterPump
          ? 0
          : failed
            ? this.options.errorRetryMs
            : this.nextDelay(nextRunAt, Date.now())
        this.wakeAfterPump = false
        this.schedule(delay)
      })
    this.pumpPromise = pump
  }

  private nextDelay(nextRunAt: Date | null, now: number): number {
    if (!nextRunAt) return this.options.reconciliationIntervalMs
    return Math.min(
      this.options.reconciliationIntervalMs,
      Math.max(0, nextRunAt.getTime() - now),
    )
  }
}
