import { createLogger, runWithLogContext } from "@alloy/logging"
import { errorMessage, isAbortError } from "@alloy/server/runtime/error-message"

import { clipMediaStore } from "./clip-media-store"
import { runMediaProcessing } from "./media-run"
import type { MediaStore } from "./media-store"
import { stagingMediaStore } from "./staging-media-store"

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
 * lease, heartbeat, retry/fail) is identical for clips and staging recordings;
 * only the table-specific SQL lives behind the {@link MediaStore}.
 */
function createMediaWorker(store: MediaStore): MediaWorker {
  const activeJobs = new Map<
    string,
    { abort: AbortController; done: Promise<void> }
  >()
  const queuedIds = new Set<string>()
  const inFlightIds = new Set<string>()
  const runningJobs = new Set<Promise<void>>()
  let wakeTimer: ReturnType<typeof setTimeout> | null = null
  let pumpPromise: Promise<void> | null = null
  let started = false
  let stopping = false

  function schedulePump(delayMs: number): void {
    if (!started || stopping) return
    if (wakeTimer && delayMs > 0) return
    if (wakeTimer) clearTimeout(wakeTimer)
    wakeTimer = setTimeout(() => {
      wakeTimer = null
      void pump()
    }, delayMs)
  }

  async function pump(): Promise<void> {
    if (pumpPromise) return pumpPromise
    pumpPromise = pumpInner()
      .catch((err) => {
        logger.error(`${store.target} media worker pump failed:`, err)
        schedulePump(POLL_INTERVAL_MS)
      })
      .finally(() => {
        pumpPromise = null
      })
    return pumpPromise
  }

  async function pumpInner(): Promise<void> {
    // No concurrency cap: durable media processing is expected to be rare, so we
    // start every pending recording as we find it. `processOne` adds the id to
    // `inFlightIds` synchronously, so the next `nextId()` won't hand it back.
    while (started && !stopping) {
      const id = await nextId()
      if (!started || stopping) return
      if (!id) {
        schedulePump(POLL_INTERVAL_MS)
        return
      }
      const job = processOne(id)
      runningJobs.add(job)
      job.finally(() => {
        runningJobs.delete(job)
        schedulePump(0)
      })
    }
  }

  async function nextId(): Promise<string | null> {
    for (const queued of queuedIds) {
      queuedIds.delete(queued)
      if (!inFlightIds.has(queued)) return queued
    }
    return store.selectNextLeasableId(inFlightIds)
  }

  async function processOne(id: string): Promise<void> {
    inFlightIds.add(id)
    try {
      await runOne(id)
    } catch (err) {
      if (isAbortError(err)) return
      logger.error(`${store.target} media job failed for ${id}:`, err)
    } finally {
      inFlightIds.delete(id)
    }
  }

  async function runOne(id: string): Promise<void> {
    const runId = crypto.randomUUID()
    const row = await store.lease(id, runId)
    if (!row) return

    const abort = new AbortController()
    let resolveDone: () => void = () => undefined
    const done = new Promise<void>((r) => {
      resolveDone = r
    })
    activeJobs.set(id, { abort, done })

    try {
      await runWithLogContext({ [store.target]: id, run: runId }, async () => {
        const stopHeartbeat = startHeartbeat(id, runId, abort)
        try {
          await runMediaProcessing(store, id, row, runId, abort.signal)
        } catch (err) {
          if (isAbortError(err)) {
            if (stopping) {
              await store.releaseLease(
                id,
                runId,
                "Media processing interrupted by shutdown",
              )
            }
          } else {
            const reason = errorMessage(err, "Media processing failed")
            if (row.encodeAttempt > RETRY_LIMIT) {
              await store.markFailed(id, reason)
            } else {
              await store.releaseLease(id, runId, reason)
            }
          }
          throw err
        } finally {
          stopHeartbeat()
        }
      })
    } finally {
      activeJobs.delete(id)
      resolveDone()
    }
  }

  function startHeartbeat(
    id: string,
    runId: string,
    abort: AbortController,
  ): () => void {
    let pending = false
    const beat = () => {
      if (pending || abort.signal.aborted) return
      pending = true
      store
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

  return {
    enqueue(id) {
      queuedIds.add(id)
      schedulePump(0)
    },
    async cancel(id) {
      const entry = activeJobs.get(id)
      if (!entry) return
      entry.abort.abort()
      await entry.done
    },
    start() {
      if (started) return
      started = true
      stopping = false
      schedulePump(0)
    },
    async stop() {
      if (!started) return
      started = false
      stopping = true
      if (wakeTimer) {
        clearTimeout(wakeTimer)
        wakeTimer = null
      }
      for (const entry of activeJobs.values()) {
        entry.abort.abort()
      }
      await Promise.allSettled(runningJobs)
    },
  }
}

const clipWorker = createMediaWorker(clipMediaStore)
const stagingWorker = createMediaWorker(stagingMediaStore)

export function enqueueClipMediaProcessing(clipId: string): void {
  clipWorker.enqueue(clipId)
}

export function cancelClipMediaProcessing(clipId: string): Promise<void> {
  return clipWorker.cancel(clipId)
}

export function enqueueStagingMediaProcessing(stagingId: string): void {
  stagingWorker.enqueue(stagingId)
}

export function cancelStagingMediaProcessing(stagingId: string): Promise<void> {
  return stagingWorker.cancel(stagingId)
}

export function startMediaWorkers(): void {
  clipWorker.start()
  stagingWorker.start()
}

export async function stopMediaWorkers(): Promise<void> {
  await Promise.all([clipWorker.stop(), stagingWorker.stop()])
}
