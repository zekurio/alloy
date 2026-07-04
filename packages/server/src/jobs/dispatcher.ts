import { createLogger, runWithLogContext } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { env } from "@alloy/server/env"
import { errorMessage, isAbortError } from "@alloy/server/runtime/error-message"

import { subscribeToQueueWake } from "./events"
import {
  JOB_QUEUES,
  getJobKind,
  registeredKindsForQueue,
  type JobHandlerContext,
  type JobQueue,
} from "./registry"
import {
  claim,
  complete,
  fail,
  heartbeat,
  releaseForShutdown,
  setProgress,
} from "./store"

const logger = createLogger("jobs")

const HEARTBEAT_MS = 30_000
const POLL_INTERVAL_MS = 5000

interface QueueSpec {
  queue: JobQueue
  concurrency: number
  restMs: number
}

interface ActiveJob {
  id: string
  kind: string
  dedupKey: string | null
  runId: string
  abort: AbortController
  done: Promise<void>
}

class JobDispatcher {
  private readonly activeJobs = new Map<string, ActiveJob>()
  private readonly activeJobsByDedup = new Map<string, ActiveJob>()
  private readonly runningJobs = new Set<Promise<void>>()
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  private pumpPromise: Promise<void> | null = null
  private restUntil = 0
  private started = false
  private stopping = false

  constructor(private readonly spec: QueueSpec) {}

  wake(): void {
    this.schedulePump(0)
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
      entry.abort.abort("shutdown")
    }
    await this.pumpPromise
    await Promise.allSettled(this.runningJobs)
  }

  private schedulePump(delayMs: number): void {
    if (!this.started || this.stopping) return
    const delay = Math.max(delayMs, this.restUntil - Date.now(), 0)
    if (this.wakeTimer && delay > 0) return
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null
      void this.pump()
    }, delay)
    this.wakeTimer.unref()
  }

  private async pump(): Promise<void> {
    if (this.pumpPromise) return this.pumpPromise
    this.pumpPromise = this.pumpInner()
      .catch((err: unknown) => {
        logger.error(`${this.spec.queue} job pump failed:`, err)
        this.schedulePump(POLL_INTERVAL_MS)
      })
      .finally(() => {
        this.pumpPromise = null
      })
    return this.pumpPromise
  }

  private async pumpInner(): Promise<void> {
    while (this.started && !this.stopping) {
      if (this.activeJobs.size >= this.spec.concurrency) return
      const leaseToken = crypto.randomUUID()
      const row = await claim(this.claimableKinds(), leaseToken)
      if (!this.started || this.stopping) {
        if (row) await releaseForShutdown(row.id, leaseToken)
        return
      }
      if (!row) {
        this.schedulePump(POLL_INTERVAL_MS)
        return
      }
      const run = this.processOne(row)
      this.runningJobs.add(run)
      run
        .finally(() => {
          this.runningJobs.delete(run)
          if (this.spec.restMs > 0)
            this.restUntil = Date.now() + this.spec.restMs
          this.schedulePump(this.spec.restMs)
        })
        .catch((err: unknown) => {
          logger.error(`${this.spec.queue} job run failed:`, err)
        })
    }
  }

  private claimableKinds(): string[] {
    const paused = new Set(configStore.get("jobs").pausedKinds)
    return registeredKindsForQueue(this.spec.queue).filter(
      (kind) => !paused.has(kind),
    )
  }

  private async processOne(row: Awaited<ReturnType<typeof claim>>) {
    if (!row) return
    const abort = new AbortController()
    const done = this.runOne(row, abort).finally(() => {
      this.activeJobs.delete(row.id)
      if (row.dedup_key) {
        this.activeJobsByDedup.delete(activeDedupKey(row.kind, row.dedup_key))
      }
    })
    const entry = {
      id: row.id,
      kind: row.kind,
      dedupKey: row.dedup_key,
      runId: row.lease_token ?? "",
      abort,
      done,
    }
    this.activeJobs.set(row.id, entry)
    if (row.dedup_key) {
      this.activeJobsByDedup.set(activeDedupKey(row.kind, row.dedup_key), entry)
    }
    await done
  }

  activeByDedup(kind: string, dedupKey: string): ActiveJob | null {
    return this.activeJobsByDedup.get(activeDedupKey(kind, dedupKey)) ?? null
  }

  private async runOne(
    row: NonNullable<Awaited<ReturnType<typeof claim>>>,
    abort: AbortController,
  ): Promise<void> {
    const registration = getJobKind(row.kind)
    const runId = row.lease_token
    if (!registration || !runId) return

    await runWithLogContext(
      { job: row.id, kind: row.kind, run: runId },
      async () => {
        const ctx = this.context(row, runId, abort)
        const stopHeartbeat = this.startHeartbeat(row, runId, abort, ctx)
        try {
          await registration.handler(row.payload, ctx)
          if (abort.signal.aborted) {
            if (this.stopping) await releaseForShutdown(row.id, runId)
            return
          }
          await complete(row.id, runId)
        } catch (err) {
          await this.handleRunError(row, runId, abort, err)
        } finally {
          stopHeartbeat()
        }
      },
    )
  }

  private context(
    row: NonNullable<Awaited<ReturnType<typeof claim>>>,
    runId: string,
    abort: AbortController,
  ): JobHandlerContext {
    const writeProgress = makeJobProgressWriter({
      id: row.id,
      commit: (pct, stage) => setProgress(row.id, runId, pct, stage),
    })
    return {
      signal: abort.signal,
      attempt: row.attempt,
      jobId: row.id,
      runId,
      setProgress: writeProgress,
    }
  }

  private async handleRunError(
    row: NonNullable<Awaited<ReturnType<typeof claim>>>,
    runId: string,
    abort: AbortController,
    err: unknown,
  ): Promise<void> {
    if (isAbortError(err) || abort.signal.aborted) {
      if (this.stopping) await releaseForShutdown(row.id, runId)
      return
    }

    const message = errorMessage(err, "Job failed")
    const result = await fail(row.id, runId, message, true)
    const registration = getJobKind(row.kind)
    if (!result.changed || !registration?.onFailed) return
    await registration.onFailed(
      row.payload,
      err instanceof Error ? err : new Error(message),
      result.willRetry,
      runId,
    )
  }

  private startHeartbeat(
    row: NonNullable<Awaited<ReturnType<typeof claim>>>,
    runId: string,
    abort: AbortController,
    ctx: JobHandlerContext,
  ): () => void {
    let pending = false
    const beat = () => {
      if (pending || abort.signal.aborted) return
      pending = true
      this.heartbeatOnce(row, runId, abort, ctx)
        .catch((err: unknown) => {
          logger.error(`job lease heartbeat failed for ${row.id}:`, err)
        })
        .finally(() => {
          pending = false
        })
    }
    const timer = setInterval(beat, HEARTBEAT_MS)
    return () => clearInterval(timer)
  }

  private async heartbeatOnce(
    row: NonNullable<Awaited<ReturnType<typeof claim>>>,
    runId: string,
    abort: AbortController,
    ctx: JobHandlerContext,
  ): Promise<void> {
    const held = await heartbeat(row.id, runId)
    if (!held) {
      abort.abort("lease-lost")
      return
    }

    const extended = await getJobKind(row.kind)?.extendLease?.(row.payload, ctx)
    if (extended === false) abort.abort("lease-lost")
  }
}

const dispatchers = new Map<JobQueue, JobDispatcher>()
let unsubscribeWake: (() => void) | null = null
let unsubscribeConfig: (() => void) | null = null

export function startDispatchers(): void {
  if (dispatchers.size > 0) return
  for (const spec of queueSpecs()) {
    const dispatcher = new JobDispatcher(spec)
    dispatchers.set(spec.queue, dispatcher)
    dispatcher.start()
  }
  unsubscribeWake = subscribeToQueueWake((queue) => {
    dispatchers.get(queue)?.wake()
  })
  unsubscribeConfig = configStore.subscribe((next, prev) => {
    if (next.jobs === prev.jobs) return
    wakeAll()
  })
}

export async function stopDispatchers(): Promise<void> {
  unsubscribeWake?.()
  unsubscribeWake = null
  unsubscribeConfig?.()
  unsubscribeConfig = null
  await Promise.all(
    [...dispatchers.values()].map((dispatcher) => dispatcher.stop()),
  )
  dispatchers.clear()
}

export function wake(queue: JobQueue): void {
  dispatchers.get(queue)?.wake()
}

export async function abortActiveJobByDedup(
  kind: string,
  dedupKey: string,
): Promise<{ jobId: string; runId: string } | null> {
  for (const dispatcher of dispatchers.values()) {
    const entry = dispatcher.activeByDedup(kind, dedupKey)
    if (!entry) continue
    entry.abort.abort("cancel")
    await entry.done
    return { jobId: entry.id, runId: entry.runId }
  }
  return null
}

function wakeAll(): void {
  for (const queue of JOB_QUEUES) wake(queue)
}

function activeDedupKey(kind: string, dedupKey: string): string {
  return `${kind}:${dedupKey}`
}

function queueSpecs(): QueueSpec[] {
  return [
    { queue: "encode", concurrency: env.transcode.concurrency, restMs: 0 },
    { queue: "io", concurrency: 1, restMs: 2000 },
    { queue: "maintenance", concurrency: 1, restMs: 0 },
  ]
}

function makeJobProgressWriter(opts: {
  id: string
  commit: (pct: number, stage?: string) => Promise<boolean>
}): (pct: number, stage?: string) => void {
  let lastWrittenPct = 0
  let lastWriteAt = 0
  return (pct: number, stage?: string) => {
    const now = Date.now()
    if (pct <= lastWrittenPct) return
    if (now - lastWriteAt < 2000 && pct < 99) return
    lastWrittenPct = pct
    lastWriteAt = now
    opts.commit(pct, stage).catch((err: unknown) => {
      logger.error(`progress update failed for ${opts.id}:`, err)
    })
  }
}
