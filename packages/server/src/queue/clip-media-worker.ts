import type { TranscodingConfig } from "@alloy/contracts"
import { createLogger, runWithLogContext } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { env } from "@alloy/server/env"
import { writeMediaReconciliationSummary } from "@alloy/server/jobs/summaries"
import { encodeFingerprint } from "@alloy/server/media/encode-fingerprint"
import { createStoredClipMentionNotifications } from "@alloy/server/notifications/service"
import { errorMessage, isAbortError } from "@alloy/server/runtime/error-message"
import { announceClipPublished } from "@alloy/server/webhooks/publish"

import {
  chooseClipMediaAction,
  type ClipMediaAction,
} from "./clip-media-policy"
import { clipMediaStore } from "./clip-media-store"
import {
  claimClipMedia,
  clipMediaClaimCompleted,
  completeClipMediaWithoutPipeline,
  failClipMedia,
  heartbeatClipMedia,
  nextClipMediaRunAt,
  recoverClipMediaWork,
  releaseClipMediaForCancellation,
  releaseClipMediaForShutdown,
  selectClipMediaFacts,
  type ClipMediaClaim,
} from "./clip-media-work-store"
import {
  forceMediaGeneration,
  synchronizeMediaGeneration,
  type MediaGeneration,
} from "./media-generation"
import { runMediaProcessing, runThumbnailBackfill } from "./media-run"
import { WakeableMediaPump } from "./wakeable-media-pump"

const logger = createLogger("media-worker")
const HEARTBEAT_MS = 30_000
const RECONCILIATION_INTERVAL_MS = 60_000
const ERROR_RETRY_MS = 5000

interface GenerationSnapshot {
  generation: MediaGeneration
  config: Readonly<TranscodingConfig>
}

interface ActiveRun {
  claim: ClipMediaClaim
  abort: AbortController
  done: Promise<void>
}

export class ClipMediaWorker {
  private readonly active = new Map<string, ActiveRun>()
  private readonly blockedClipIds = new Map<string, number>()
  private readonly scheduler = new WakeableMediaPump({
    reconciliationIntervalMs: RECONCILIATION_INTERVAL_MS,
    errorRetryMs: ERROR_RETRY_MS,
    runPass: () => this.pumpInner(),
    onError: (cause) => logger.error("media pump failed:", cause),
  })
  private startPromise: Promise<void> | null = null
  private refreshPromise: Promise<void> = Promise.resolve()
  private refreshRetryTimer: ReturnType<typeof setTimeout> | null = null
  private unsubscribeConfig: (() => void) | null = null
  private snapshot: GenerationSnapshot | null = null
  private started = false
  private stopping = false

  start(): Promise<void> {
    if (this.started) return Promise.resolve()
    if (this.startPromise) return this.startPromise
    this.stopping = false
    const starting = this.startInner().finally(() => {
      if (this.startPromise === starting) this.startPromise = null
    })
    this.startPromise = starting
    return starting
  }

  private async startInner(): Promise<void> {
    await recoverClipMediaWork()
    if (this.stopping) return
    const generation = await this.refresh(configStore.get("transcoding"))
    if (this.stopping) return
    this.started = true
    this.unsubscribeConfig = configStore.subscribe((next, prev) => {
      if (next.transcoding === prev.transcoding) return
      this.queueRefresh()
    })
    this.scheduler.start()
    void writeReconciliationSummaryBestEffort(generation.generation, "stale")
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.startPromise
    if (!this.started) {
      this.stopping = false
      return
    }
    this.started = false
    this.unsubscribeConfig?.()
    this.unsubscribeConfig = null
    if (this.refreshRetryTimer) clearTimeout(this.refreshRetryTimer)
    this.refreshRetryTimer = null
    for (const run of this.active.values()) run.abort.abort("shutdown")
    await this.scheduler.stop()
    await Promise.allSettled([...this.active.values()].map((run) => run.done))
    await this.refreshPromise
    this.stopping = false
  }

  wake(): void {
    this.scheduler.wake()
  }

  async forceReconciliation(): Promise<MediaGeneration> {
    const config = frozenConfig(configStore.get("transcoding"))
    const generation = await forceMediaGeneration(config)
    this.installSnapshot(generation, config)
    this.wake()
    await writeReconciliationSummaryBestEffort(generation.generation, "force")
    return generation
  }

  async reconcile(): Promise<MediaGeneration> {
    await this.refresh(configStore.get("transcoding"))
    this.wake()
    await writeReconciliationSummaryBestEffort(
      this.requireSnapshot().generation.generation,
      "stale",
    )
    return this.requireSnapshot().generation
  }

  async withStopped<T>(
    clipId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.blockedClipIds.set(clipId, (this.blockedClipIds.get(clipId) ?? 0) + 1)
    try {
      const active = this.active.get(clipId)
      if (active) {
        active.abort.abort("cancel")
        await active.done
      }
      return await operation()
    } finally {
      const remaining = (this.blockedClipIds.get(clipId) ?? 1) - 1
      if (remaining > 0) this.blockedClipIds.set(clipId, remaining)
      else this.blockedClipIds.delete(clipId)
      this.wake()
    }
  }

  private queueRefresh(): void {
    if (this.refreshRetryTimer) clearTimeout(this.refreshRetryTimer)
    this.refreshRetryTimer = null
    this.refreshPromise = this.refreshPromise
      // Read at execution time so rapid A -> B changes cannot replay A after
      // B has already committed its generation.
      .then(() => this.refresh(configStore.get("transcoding")))
      .then((generation) => {
        this.wake()
        void writeReconciliationSummaryBestEffort(
          generation.generation,
          "stale",
        )
      })
      .catch((cause: unknown) => {
        logger.error("failed to refresh media generation:", cause)
        this.scheduleRefreshRetry()
      })
  }

  private async refresh(config: TranscodingConfig): Promise<MediaGeneration> {
    const frozen = frozenConfig(config)
    const generation = await synchronizeMediaGeneration(frozen)
    this.installSnapshot(generation, frozen)
    return this.requireSnapshot().generation
  }

  private installSnapshot(
    generation: MediaGeneration,
    config: Readonly<TranscodingConfig>,
  ): void {
    if (
      this.snapshot &&
      this.snapshot.generation.generation > generation.generation
    ) {
      return
    }
    this.snapshot = { generation, config }
  }

  private scheduleRefreshRetry(): void {
    if (!this.started || this.stopping || this.refreshRetryTimer) return
    this.refreshRetryTimer = setTimeout(() => {
      this.refreshRetryTimer = null
      this.queueRefresh()
    }, ERROR_RETRY_MS)
    this.refreshRetryTimer.unref()
  }

  private async pumpInner(): Promise<Date | null> {
    while (this.started && !this.stopping) {
      if (this.active.size >= env.transcode.concurrency) return null
      const snapshot = this.requireSnapshot()
      const excludedClipIds = [
        ...this.blockedClipIds.keys(),
        ...this.active.keys(),
      ]
      const claim = await claimClipMedia(snapshot.generation, excludedClipIds)
      if (!this.started || this.stopping) {
        if (claim) await releaseClipMediaForShutdown(claim)
        return null
      }
      if (!claim) {
        return nextClipMediaRunAt(excludedClipIds)
      }
      if (this.blockedClipIds.has(claim.id)) {
        await releaseClipMediaForCancellation(claim)
        return nextClipMediaRunAt([...this.blockedClipIds.keys()])
      }
      this.startRun(claim, snapshot)
    }
    return null
  }

  private startRun(claim: ClipMediaClaim, snapshot: GenerationSnapshot): void {
    const abort = new AbortController()
    const done = this.processRun(claim, snapshot, abort)
      .catch((cause: unknown) =>
        logger.error(`media run failed for ${claim.id}:`, cause),
      )
      .finally(() => {
        this.active.delete(claim.id)
        this.wake()
      })
    this.active.set(claim.id, { claim, abort, done })
  }

  private async processRun(
    claim: ClipMediaClaim,
    snapshot: GenerationSnapshot,
    abort: AbortController,
  ): Promise<void> {
    await runWithLogContext({ clip: claim.id, run: claim.runId }, async () => {
      const stopHeartbeat = this.startHeartbeat(claim, abort)
      const action = actionFor(claim, snapshot)
      try {
        let completed = true
        if (action === "skip" || action === "quarantine") {
          completed = await completeClipMediaWithoutPipeline(claim, {
            quarantined: action === "quarantine",
          })
        } else if (action === "thumbnail") {
          await runThumbnailBackfill(
            clipMediaStore,
            claim.id,
            claim.row,
            claim.runId,
            abort.signal,
            completionFor(claim),
          )
        } else {
          await runMediaProcessing(
            clipMediaStore,
            claim.id,
            claim.row,
            claim.runId,
            abort.signal,
            {
              config: snapshot.config,
              completion: completionFor(claim),
            },
          )
        }

        if (abort.signal.aborted) {
          if (await this.finishCommittedClaim(claim)) return
          await this.handleAbort(claim, abort.signal)
          return
        }
        if (completed) await announceReadySideEffects(claim.id)
      } catch (cause) {
        const failureMessage = errorMessage(cause, "Media processing failed")
        if (await this.finishCommittedClaim(claim, failureMessage)) return
        if (isAbortError(cause) || abort.signal.aborted) {
          await this.handleAbort(claim, abort.signal)
          return
        }
        const facts = await selectClipMediaFacts(claim.id)
        const failedFingerprint = facts
          ? encodeFingerprint(snapshot.config, facts)
          : null
        const outcome = await failClipMedia(claim, failureMessage, {
          encodeFailedFingerprint: failedFingerprint,
          thumbnailOnly: action === "thumbnail",
        })
        if (outcome === "retry" || outcome === "superseded") this.wake()
      } finally {
        stopHeartbeat()
      }
    })
  }

  private startHeartbeat(
    claim: ClipMediaClaim,
    abort: AbortController,
  ): () => void {
    let pending = false
    const timer = setInterval(() => {
      if (pending || abort.signal.aborted) return
      pending = true
      heartbeatClipMedia(claim)
        .then(async (held) => {
          if (!held && !(await clipMediaClaimCompleted(claim))) {
            abort.abort("lease-lost")
          }
        })
        .catch((cause: unknown) => {
          logger.error(`media heartbeat failed for ${claim.id}:`, cause)
        })
        .finally(() => {
          pending = false
        })
    }, HEARTBEAT_MS)
    timer.unref()
    return () => clearInterval(timer)
  }

  private async finishCommittedClaim(
    claim: ClipMediaClaim,
    tailFailure?: string,
  ): Promise<boolean> {
    if (!(await clipMediaClaimCompleted(claim))) return false
    if (tailFailure !== undefined) {
      logger.warn(
        `media run ${claim.runId} completed durably before tail work failed:`,
        tailFailure,
      )
    }
    await announceReadySideEffects(claim.id)
    return true
  }

  private async handleAbort(
    claim: ClipMediaClaim,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.reason === "shutdown") await releaseClipMediaForShutdown(claim)
    if (signal.reason === "cancel") await releaseClipMediaForCancellation(claim)
  }

  private requireSnapshot(): GenerationSnapshot {
    if (!this.snapshot)
      throw new Error("Media worker has no generation snapshot")
    return this.snapshot
  }
}

export const clipMediaWorker = new ClipMediaWorker()

export const startClipMediaWorker = () => clipMediaWorker.start()
export const stopClipMediaWorker = () => clipMediaWorker.stop()
export const wakeClipMediaWorker = () => clipMediaWorker.wake()
export const reconcileClipMedia = () => clipMediaWorker.reconcile()
export const forceReconcileClipMedia = () =>
  clipMediaWorker.forceReconciliation()
export const withClipMediaStopped = <T>(
  clipId: string,
  operation: () => Promise<T>,
) => clipMediaWorker.withStopped(clipId, operation)

function actionFor(
  claim: ClipMediaClaim,
  snapshot: GenerationSnapshot,
): ClipMediaAction {
  return chooseClipMediaAction({
    force: claim.force,
    status: claim.status,
    facts: claim.facts,
    encodeFingerprint: claim.encodeFingerprint,
    encodeFailedFingerprint: claim.encodeFailedFingerprint,
    encodeFailedGeneration: claim.encodeFailedGeneration,
    hasSource: claim.row.sourceKey !== null,
    hasThumbnail: claim.row.thumbKey !== null,
    thumbnailFailed: claim.row.thumbFailedAt !== null,
    config: snapshot.config,
    retryFailuresGeneration: snapshot.generation.retryFailuresGeneration,
  })
}

function completionFor(claim: ClipMediaClaim) {
  return {
    requestId: claim.requestId,
    targetGeneration: claim.targetGeneration,
  }
}

async function announceReadySideEffects(clipId: string): Promise<void> {
  await createStoredClipMentionNotifications(clipId).catch((cause: unknown) =>
    logger.error("notification fan-out failed:", cause),
  )
  announceClipPublished(clipId)
}

async function writeReconciliationSummaryBestEffort(
  generation: number,
  mode: "stale" | "force",
): Promise<void> {
  await writeMediaReconciliationSummary(generation, mode).catch(
    (cause: unknown) =>
      logger.error("failed to write media reconciliation summary:", cause),
  )
}

function frozenConfig(config: TranscodingConfig): Readonly<TranscodingConfig> {
  return deepFreeze(structuredClone(config))
}

function deepFreeze<T>(value: T): T {
  if (!value || Object(value) !== value || Object.isFrozen(value)) return value
  for (const child of Object.values(Object(value))) deepFreeze(child)
  return Object.freeze(value)
}
