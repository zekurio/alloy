import { clip } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { resetFailedClipForEncode } from "@alloy/server/clips/reencode"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import {
  encodeFingerprint,
  type FingerprintSourceFacts,
} from "@alloy/server/media/encode-fingerprint"
import { createStoredClipMentionNotifications } from "@alloy/server/notifications/service"
import { errorMessage } from "@alloy/server/runtime/error-message"
import { and, eq, isNull, sql } from "drizzle-orm"
import { z } from "zod"

import { clipMediaStore } from "../../queue/clip-media-store"
import {
  ENCODE_LEASE_STALE_INTERVAL,
  ENCODE_LEASE_STALE_MS,
} from "../../queue/lease-conditions"
import { runMediaProcessing, runThumbnailBackfill } from "../../queue/media-run"
import { abortActiveJobByDedup } from "../dispatcher"
import { defineJobKind, type JobHandlerContext } from "../registry"
import {
  cancel,
  cancelByKindDedup,
  enqueue,
  hasLiveJob,
  snooze,
  type EnqueueOptions,
  wakeQueueForKind,
} from "../store"
import { enqueueWebhookSync } from "./webhook-sync"

const CLIP_ENCODE_KIND = "clip.encode"
const logger = createLogger("jobs")
const SNOOZE_JITTER_MS = 1000

const ClipEncodePayloadSchema = z.object({
  clipId: z.uuid(),
  trigger: z.enum([
    "upload",
    "trim",
    "reencode",
    "reconcile",
    "sweep",
    "repair",
  ]),
})

export type ClipEncodeTrigger = z.infer<
  typeof ClipEncodePayloadSchema
>["trigger"]

export interface ClipEncodeOptions {
  trigger: ClipEncodeTrigger
  priority: number
}

export type RequeueClipEncodeResult =
  | { ok: true }
  | { ok: false; reason: "active-lease" | "missing" }

defineJobKind({
  kind: CLIP_ENCODE_KIND,
  queue: "encode",
  schema: ClipEncodePayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 3, backoffMs: 30_000 },
  handler: runClipEncode,
  onFailed: handleClipEncodeFailed,
  onRetry: handleClipEncodeRetry,
  extendLease: extendClipLease,
})

export function enqueueClipEncode(
  clipId: string,
  options: ClipEncodeOptions & { tx?: EnqueueOptions["tx"] },
): Promise<string> {
  return enqueue(
    CLIP_ENCODE_KIND,
    { clipId, trigger: options.trigger },
    {
      priority: options.priority,
      dedupKey: clipId,
      tx: options.tx,
    },
  )
}

export function wakeClipEncodeQueue(): void {
  wakeQueueForKind(CLIP_ENCODE_KIND)
}

export async function requeueClipEncode(
  clipId: string,
  options: ClipEncodeOptions,
): Promise<RequeueClipEncodeResult> {
  const lease = await selectClipEncodeLease(clipId)
  if (!lease) return { ok: false, reason: "missing" }
  if (lease.fresh) return { ok: false, reason: "active-lease" }
  await enqueueClipEncode(clipId, options)
  return { ok: true }
}

export async function cancelClipEncode(clipId: string): Promise<void> {
  const active = await abortActiveJobByDedup(CLIP_ENCODE_KIND, clipId)
  if (active) {
    await clipMediaStore.releaseLease(
      clipId,
      active.runId,
      "Media processing cancelled",
    )
    await cancel(active.jobId)
  }
  await cancelByKindDedup(CLIP_ENCODE_KIND, clipId)
}

export function hasLiveClipEncodeJob(clipId: string): Promise<boolean> {
  return hasLiveJob(CLIP_ENCODE_KIND, clipId)
}

async function runClipEncode(
  payload: z.infer<typeof ClipEncodePayloadSchema>,
  ctx: JobHandlerContext,
): Promise<void> {
  const row = await selectClipEncodeLease(payload.clipId)
  if (!row || (row.status !== "processing" && row.status !== "ready")) return
  const matchingAction = await matchingFingerprintAction(payload, row)
  if (matchingAction === "skip") {
    if (payload.trigger === "upload") {
      await fanOutReadyClipPublish(payload.clipId)
    }
    return
  }

  const leased = await clipMediaStore.lease(payload.clipId, ctx.runId)
  if (!leased) {
    const current = await selectClipEncodeLease(payload.clipId)
    if (current?.fresh && current.encodeLockedAt) {
      await snooze(
        ctx.jobId,
        ctx.runId,
        new Date(
          current.encodeLockedAt.getTime() +
            ENCODE_LEASE_STALE_MS +
            SNOOZE_JITTER_MS,
        ),
      )
    }
    return
  }

  try {
    if (matchingAction === "thumbnail") {
      await runThumbnailBackfill(
        clipMediaStore,
        payload.clipId,
        leased,
        ctx.runId,
        ctx.signal,
      )
    } else {
      await runMediaProcessing(
        clipMediaStore,
        payload.clipId,
        leased,
        ctx.runId,
        ctx.signal,
      )
    }
    if (ctx.signal.aborted && ctx.signal.reason === "shutdown") {
      await clipMediaStore.releaseLease(
        payload.clipId,
        ctx.runId,
        "Media processing interrupted by shutdown",
      )
    }
    if (payload.trigger === "upload") {
      await fanOutReadyClipPublish(payload.clipId)
    }
  } catch (err) {
    if (ctx.signal.aborted && ctx.signal.reason === "shutdown") {
      await clipMediaStore.releaseLease(
        payload.clipId,
        ctx.runId,
        "Media processing interrupted by shutdown",
      )
    }
    throw err
  }
}

// First-publish fan-out: mention notifications plus the publish-webhook
// reconciler (which itself checks privacy and announces only public clips).
async function fanOutReadyClipPublish(clipId: string): Promise<void> {
  const [ready] = await db
    .select({ id: clip.id })
    .from(clip)
    .where(and(eq(clip.id, clipId), eq(clip.status, "ready")))
    .limit(1)
  if (!ready) return
  await createStoredClipMentionNotifications(clipId).catch((error) =>
    logger.error("notification fan-out failed", error),
  )
  await enqueueWebhookSync(clipId)
}

async function handleClipEncodeFailed(
  payload: z.infer<typeof ClipEncodePayloadSchema>,
  error: Error,
  willRetry: boolean,
  runId: string,
): Promise<void> {
  const reason = errorMessage(error, "Media processing failed")
  if (willRetry) {
    await clipMediaStore.releaseLease(payload.clipId, runId, reason)
    return
  }
  await clipMediaStore.markFailed(
    payload.clipId,
    runId,
    reason,
    failedFingerprint(await selectFailedClipFacts(payload.clipId)),
  )
}

// Admin "Retry" re-arms the failed encode job, but the handler no-ops on a
// failed clip. Flip it back to processing (a clip not in failed status is left
// untouched) so the requeued run actually re-encodes instead of completing on a
// still-quarantined clip.
async function handleClipEncodeRetry(
  payload: z.infer<typeof ClipEncodePayloadSchema>,
): Promise<void> {
  await resetFailedClipForEncode(payload.clipId)
}

async function selectFailedClipFacts(
  clipId: string,
): Promise<FingerprintSourceFacts | null> {
  try {
    return await selectClipEncodeFacts(clipId)
  } catch {
    // Quarantine can fall back to null facts without losing terminal markFailed.
    return null
  }
}

function extendClipLease(
  payload: z.infer<typeof ClipEncodePayloadSchema>,
  ctx: JobHandlerContext,
): Promise<boolean> {
  return clipMediaStore.heartbeat(payload.clipId, ctx.runId)
}

async function selectClipEncodeLease(clipId: string): Promise<{
  status: typeof clip.$inferSelect.status
  encodeLockedAt: Date | null
  fresh: boolean
  encodeFingerprint: string | null
  sourceKey: string | null
  thumbKey: string | null
  thumbFailedAt: Date | null
  facts: FingerprintSourceFacts | null
} | null> {
  const [row] = await db
    .select({
      status: clip.status,
      encodeLockedAt: clip.encode_locked_at,
      fresh: sql<boolean>`coalesce(${clip.encode_run_id} is not null and ${clip.encode_locked_at} >= now() - interval '${sql.raw(ENCODE_LEASE_STALE_INTERVAL)}', false)`,
      encodeFingerprint: clip.encode_fingerprint,
      sourceKey: clip.source_key,
      thumbKey: clip.thumb_key,
      thumbFailedAt: clip.thumb_failed_at,
      height: clip.height,
      sourceFps: clip.source_fps,
      sourceContentType: clip.source_content_type,
      sourceCodecs: clip.source_codecs,
      trimStartMs: clip.trim_start_ms,
      trimEndMs: clip.trim_end_ms,
    })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  if (!row) return null
  return {
    ...row,
    facts:
      row.height === null || row.sourceFps === null
        ? null
        : {
            height: row.height,
            sourceFps: row.sourceFps,
            sourceContentType: row.sourceContentType,
            sourceCodecs: row.sourceCodecs,
            trimStartMs: row.trimStartMs,
            trimEndMs: row.trimEndMs,
          },
  }
}

async function selectClipEncodeFacts(
  clipId: string,
): Promise<FingerprintSourceFacts | null> {
  const row = await selectClipEncodeLease(clipId)
  return row?.facts ?? null
}

async function matchingFingerprintAction(
  payload: z.infer<typeof ClipEncodePayloadSchema>,
  row: NonNullable<Awaited<ReturnType<typeof selectClipEncodeLease>>>,
): Promise<"full" | "skip" | "thumbnail"> {
  if (payload.trigger === "reencode") return "full"
  if (row.status !== "ready" || !row.facts) return "full"
  if (
    row.encodeFingerprint !==
    encodeFingerprint(configStore.get("transcoding"), row.facts)
  ) {
    return "full"
  }
  if (!row.thumbKey && !row.thumbFailedAt && row.sourceKey) {
    return "thumbnail"
  }
  await db
    .update(clip)
    .set({ encode_progress: 100, updated_at: new Date() })
    .where(
      and(
        eq(clip.id, payload.clipId),
        eq(clip.status, "ready"),
        isNull(clip.encode_run_id),
      ),
    )
  return "skip"
}

function failedFingerprint(
  facts: FingerprintSourceFacts | null,
): string | null {
  if (!facts) return null
  return encodeFingerprint(configStore.get("transcoding"), facts)
}
