import { createLogger, runWithLogContext } from "@alloy/logging"
import { env } from "@alloy/server/env"
import { errorMessage, isAbortError } from "@alloy/server/runtime/error-message"

import { clipMediaStore } from "./clip-media-store"
import { runMediaProcessing } from "./media-run"
import type { MediaStore } from "./media-store"

const logger = createLogger("queue")

const RETRY_LIMIT = 2
const ENCODE_LEASE_HEARTBEAT_MS = 30_000
const POLL_INTERVAL_MS = 5000

interface MediaWorker {
  enqueue(id: string): void
  cancel(id: string): Promise<void>
  start(): void
  stop(): Promise<void>
}

/**
 * One lease-loop worker for a single media store. The orchestration (pump,
 * lease, heartbeat, retry/fail) lives here; table-specific SQL stays behind
 * the {@link MediaStore}.
 */
class LeaseLoopMediaWorker implements MediaWorker {
  private readonly activeJobs = new Map<
    string,
    { abort: AbortController; done: Promise<void> }
  >()
  private readonly queuedIds = new Set<string>()
  private readonly inFlightIds = new Set<string>()
  private readonly runningJobs = new Set<Promise<void>>()
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  private pumpPromise: Promise<void> | null = null
  private started = false
  private stopping = false

  constructor(private readonly store: MediaStore) {}

  enqueue(id: string): void {
    this.queuedIds.add(id)
    this.schedulePump(0)
  }

  async cancel(id: string): Promise<void> {
    const entry = this.activeJobs.get(id)
    if (!entry) return
    entry.abort.abort()
    await entry.done
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.stopping = false
    this.schedulePump(0)
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    this.stopping = true
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }
    for (const entry of this.activeJobs.values()) {
      entry.abort.abort()
    }
    await Promise.allSettled(this.runningJobs)
  }

  private schedulePump(delayMs: number): void {
    if (!this.started || this.stopping) return
    if (this.wakeTimer && delayMs > 0) return
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null
      void this.pump()
    }, delayMs)
  }

  private async pump(): Promise<void> {
    if (this.pumpPromise) return this.pumpPromise
    this.pumpPromise = this.pumpInner()
      .catch((err) => {
        logger.error(`${this.store.target} media worker pump failed:`, err)
        this.schedulePump(POLL_INTERVAL_MS)
      })
      .finally(() => {
        this.pumpPromise = null
      })
    return this.pumpPromise
  }

  private async pumpInner(): Promise<void> {
    // Each job runs a CPU-heavy ffmpeg encode, so in-flight work is capped;
    // job completion re-pumps at 0ms, which picks up the next pending row.
    // `processOne` adds the id to `inFlightIds` synchronously, so the next
    // `nextId()` won't hand it back.
    while (this.started && !this.stopping) {
      if (this.inFlightIds.size >= env.transcode.concurrency) return
      const id = await this.nextId()
      if (!this.started || this.stopping) return
      if (!id) {
        this.schedulePump(POLL_INTERVAL_MS)
        return
      }
      const job = this.processOne(id)
      this.runningJobs.add(job)
      job.finally(() => {
        this.runningJobs.delete(job)
        this.schedulePump(0)
      })
    }
  }

  private async nextId(): Promise<string | null> {
    for (const queued of this.queuedIds) {
      this.queuedIds.delete(queued)
      if (!this.inFlightIds.has(queued)) return queued
    }
    return this.store.selectNextLeasableId(this.inFlightIds)
  }

  private async processOne(id: string): Promise<void> {
    this.inFlightIds.add(id)
    try {
      await this.runOne(id)
    } catch (err) {
      if (isAbortError(err)) return
      logger.error(`${this.store.target} media job failed for ${id}:`, err)
    } finally {
      this.inFlightIds.delete(id)
    }
  }

  private async runOne(id: string): Promise<void> {
    const runId = crypto.randomUUID()
    const row = await this.store.lease(id, runId)
    if (!row) return

    const abort = new AbortController()
    let resolveDone: () => void = () => undefined
    const done = new Promise<void>((r) => {
      resolveDone = r
    })
    this.activeJobs.set(id, { abort, done })

    try {
      await runWithLogContext(
        { [this.store.target]: id, run: runId },
        async () => {
          const stopHeartbeat = this.startHeartbeat(id, runId, abort)
          try {
            await runMediaProcessing(this.store, id, row, runId, abort.signal)
          } catch (err) {
            await this.handleRunError({
              err,
              id,
              runId,
              attempt: row.encodeAttempt,
            })
            throw err
          } finally {
            stopHeartbeat()
          }
        },
      )
    } finally {
      this.activeJobs.delete(id)
      resolveDone()
    }
  }

  private async handleRunError({
    err,
    id,
    runId,
    attempt,
  }: {
    err: unknown
    id: string
    runId: string
    attempt: number
  }): Promise<void> {
    if (isAbortError(err)) {
      if (this.stopping) {
        await this.store.releaseLease(
          id,
          runId,
          "Media processing interrupted by shutdown",
        )
      }
      return
    }

    const reason = errorMessage(err, "Media processing failed")
    if (attempt > RETRY_LIMIT) {
      await this.store.markFailed(id, reason)
    } else {
      await this.store.releaseLease(id, runId, reason)
    }
  }

  private startHeartbeat(
    id: string,
    runId: string,
    abort: AbortController,
  ): () => void {
    let pending = false
    const beat = () => {
      if (pending || abort.signal.aborted) return
      pending = true
      this.store
        .heartbeat(id, runId)
        .then((held) => {
          if (!held) abort.abort()
        })
        .catch((err: unknown) => {
          logger.error(`encode lease heartbeat failed for ${id}:`, err)
        })
        .finally(() => {
          pending = false
        })
    }
    const timer = setInterval(beat, ENCODE_LEASE_HEARTBEAT_MS)
    return () => clearInterval(timer)
  }
}

function createMediaWorker(store: MediaStore): MediaWorker {
  return new LeaseLoopMediaWorker(store)
}

const clipWorker = createMediaWorker(clipMediaStore)

export function enqueueClipMediaProcessing(clipId: string): void {
  clipWorker.enqueue(clipId)
}

export function cancelClipMediaProcessing(clipId: string): Promise<void> {
  return clipWorker.cancel(clipId)
}

export function startMediaWorkers(): void {
  clipWorker.start()
}

export async function stopMediaWorkers(): Promise<void> {
  await clipWorker.stop()
}
