import { AdminStorageGcSummarySchema } from "@alloy/contracts"
import { CLIP_AUDIO_TRACKS_MAX } from "@alloy/contracts/content"
import { safeParse, t } from "@alloy/contracts/schema"
import {
  clip,
  clipAudioTrack,
  clipRendition,
  instanceSetting,
  job,
} from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { storageDeletionHasLiveReference } from "@alloy/server/storage/deletion-references"
import {
  clipAssetDir,
  clipAssetKey,
  type StorageDriver,
} from "@alloy/server/storage/driver"
import { deleteStorageGcCandidate } from "@alloy/server/storage/gc-candidate-deletion"
import { clipStorage, clipThumbnailStorage } from "@alloy/server/storage/index"
import { storageObjectWriteIsActive } from "@alloy/server/storage/write-activity"
import { and, eq, inArray, sql } from "drizzle-orm"

import {
  defineJobKind,
  type JobFailureContext,
  type JobHandlerContext,
} from "../registry"
import { enqueue, type EnqueueOptions, wakeQueueForKind } from "../store"
import { leasedRunningJob } from "../store-database"
import type { JobTransaction } from "../store-types"
import { writeStorageMaintenanceSummary } from "./storage-maintenance-summary"

const logger = createLogger("jobs")
const STORAGE_ORPHAN_GC_KIND = "storage.orphan-gc"
const PAGE_SIZE = 500
const STORAGE_GC_MAX_CANDIDATES = 10_000
// Comfortably above encode timeout ceilings and lease-retry cycles, so
// in-flight runs' freshly uploaded objects are never collected.
const ORPHAN_SAFETY_MARGIN_MS = 48 * 60 * 60 * 1000
const PREVIEW_CONFIRMATION_MAX_AGE_MS = 60 * 60 * 1000
const STORAGE_GC_SUMMARY_KEY = "storageGc"
const STORAGE_GC_CONFIRMATION_KEY = "storageGcConfirmation"
const STORAGE_GC_MANIFEST_KEY = "storageGcManifest"
const AUDIO_TRACK_ASSET_RE = new RegExp(
  `^audio-[0-${CLIP_AUDIO_TRACKS_MAX - 1}]-[0-9a-f]{12}\\.m4a$`,
  "i",
)

const StorageOrphanGcPayloadSchema = t.union([
  t.object({ mode: t.enum(["preview"]) }).strict(),
  t
    .object({
      mode: t.enum(["delete"]),
      previewJobId: t.string().uuid(),
      cutoffAt: t.string().datetime({ offset: true }),
    })
    .strict(),
])
const StorageGcConfirmationSchema = t.object({
  previewJobId: t.string().uuid(),
  jobId: t.string().uuid(),
})
const StorageGcCandidateSchema = t
  .object({
    storage: t.enum(["clip", "thumbnail"]),
    key: t.string().min(1),
    kind: t.enum(["orphan", "stale"]),
  })
  .strict()
const StorageGcManifestSchema = t
  .object({
    previewJobId: t.string().uuid(),
    cutoffAt: t.string().datetime({ offset: true }),
    hasMoreCandidates: t.boolean(),
    candidates: t
      .array(StorageGcCandidateSchema)
      .max(STORAGE_GC_MAX_CANDIDATES),
  })
  .strict()

type StorageOrphanGcPayload = t.infer<typeof StorageOrphanGcPayloadSchema>
type StorageGcCandidate = t.infer<typeof StorageGcCandidateSchema>
type StorageGcManifest = t.infer<typeof StorageGcManifestSchema>

interface StorageGcSummary {
  jobId: string
  previewJobId: string
  mode: StorageOrphanGcPayload["mode"]
  finishedAt: string
  confirmationExpiresAt: string | null
  cutoffAt: string
  hasMoreCandidates: boolean
  scanned: number
  orphanCandidates: number
  staleAssetCandidates: number
  deletedOrphanObjects: number
  deletedStaleAssets: number
  deleteFailures: number
}

interface ParsedStorageKey {
  clipId: string
  filename: string
}

interface GcEntry {
  key: string
  lastModified: Date | null
  storage: StorageDriver
  storageKind: StorageGcCandidate["storage"]
}

interface GcClipRow {
  id: string
  sourceKey: string | null
  waveformKey: string | null
  cutKey: string | null
  thumbKey: string | null
  encodeRunId: string | null
}

defineJobKind({
  kind: STORAGE_ORPHAN_GC_KIND,
  queue: "io",
  schema: StorageOrphanGcPayloadSchema,
  defaultPriority: 80,
  retry: { maxAttempts: 1, backoffMs: 60_000 },
  adminRetryable: false,
  handler: runStorageOrphanGc,
  onFailed: handleStorageOrphanGcFailed,
})

export function enqueueStorageOrphanGcPreview(
  options: Pick<EnqueueOptions, "runAt"> = {},
): Promise<string | null> {
  return enqueueModeSafePreview(options)
}

async function enqueueModeSafePreview(
  options: Pick<EnqueueOptions, "runAt">,
): Promise<string | null> {
  const dedupKey = `${STORAGE_ORPHAN_GC_KIND}:preview`
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${STORAGE_ORPHAN_GC_KIND}), hashtext(${dedupKey}))`,
    )
    await tx
      .select({ key: instanceSetting.key })
      .from(instanceSetting)
      .where(eq(instanceSetting.key, STORAGE_GC_SUMMARY_KEY))
      .for("update")
    const liveJobs = await tx
      .select({ id: job.id, dedupKey: job.dedup_key })
      .from(job)
      .where(
        and(
          eq(job.kind, STORAGE_ORPHAN_GC_KIND),
          inArray(job.status, ["pending", "running"]),
        ),
      )
    if (liveJobs.some((liveJob) => liveJob.dedupKey !== dedupKey)) return null
    const existingPreview = liveJobs[0]
    if (existingPreview) {
      return { jobId: existingPreview.id, enqueued: false }
    }
    return {
      jobId: await enqueue(
        STORAGE_ORPHAN_GC_KIND,
        { mode: "preview" },
        {
          dedupKey,
          priority: 80,
          runAt: options.runAt,
          tx,
        },
      ),
      enqueued: true,
    }
  })
  if (!result) return null
  if (result.enqueued) wakeQueueForKind(STORAGE_ORPHAN_GC_KIND)
  return result.jobId
}

function enqueueStorageOrphanGcDelete(
  previewJobId: string,
  cutoffAt: string,
  options: Pick<EnqueueOptions, "runAt" | "tx"> = {},
): Promise<string> {
  return enqueue(
    STORAGE_ORPHAN_GC_KIND,
    { mode: "delete", previewJobId, cutoffAt },
    {
      dedupKey: `${STORAGE_ORPHAN_GC_KIND}:delete:${previewJobId}`,
      priority: 80,
      runAt: options.runAt,
      tx: options.tx,
    },
  )
}

export async function confirmStorageOrphanGcPreview(
  previewJobId: string,
): Promise<string | null> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ value: instanceSetting.value })
      .from(instanceSetting)
      .where(eq(instanceSetting.key, STORAGE_GC_SUMMARY_KEY))
      .for("update")
    const parsed = safeParse(AdminStorageGcSummarySchema, row?.value)
    if (!parsed.success) return null
    if (parsed.data.mode === "delete") return null
    if (parsed.data.previewJobId !== previewJobId) return null
    // A preview grants short-lived permission to delete only its manifest.
    if (
      !parsed.data.confirmationExpiresAt ||
      Date.now() >= new Date(parsed.data.confirmationExpiresAt).getTime()
    ) {
      return null
    }

    const [manifestRow] = await tx
      .select({ value: instanceSetting.value })
      .from(instanceSetting)
      .where(eq(instanceSetting.key, STORAGE_GC_MANIFEST_KEY))
    const manifest = safeParse(StorageGcManifestSchema, manifestRow?.value)
    if (!manifest.success) return null
    if (manifest.data.previewJobId !== previewJobId) return null
    if (manifest.data.cutoffAt !== parsed.data.cutoffAt) return null
    if (!manifestMatchesSummary(manifest.data, parsed.data)) return null

    const [livePreview] = await tx
      .select({ id: job.id })
      .from(job)
      .where(
        and(
          eq(job.kind, STORAGE_ORPHAN_GC_KIND),
          eq(job.dedup_key, `${STORAGE_ORPHAN_GC_KIND}:preview`),
          inArray(job.status, ["pending", "running"]),
        ),
      )
      .limit(1)
    if (livePreview) return null

    const [confirmationRow] = await tx
      .select({ value: instanceSetting.value })
      .from(instanceSetting)
      .where(eq(instanceSetting.key, STORAGE_GC_CONFIRMATION_KEY))
    const confirmation = safeParse(
      StorageGcConfirmationSchema,
      confirmationRow?.value,
    )
    if (
      confirmation.success &&
      confirmation.data.previewJobId === previewJobId
    ) {
      return { jobId: confirmation.data.jobId, enqueued: false }
    }

    const jobId = await enqueueStorageOrphanGcDelete(
      previewJobId,
      parsed.data.cutoffAt,
      { runAt: new Date(), tx },
    )
    await writeStorageMaintenanceSummary(
      STORAGE_GC_CONFIRMATION_KEY,
      { previewJobId, jobId },
      tx,
    )
    return { jobId, enqueued: true }
  })
  if (result?.enqueued) wakeQueueForKind(STORAGE_ORPHAN_GC_KIND)
  return result?.jobId ?? null
}

function manifestMatchesSummary(
  manifest: StorageGcManifest,
  summary: t.infer<typeof AdminStorageGcSummarySchema>,
): boolean {
  return (
    manifest.candidates.filter((candidate) => candidate.kind === "orphan")
      .length === summary.orphanCandidates &&
    manifest.candidates.filter((candidate) => candidate.kind === "stale")
      .length === summary.staleAssetCandidates &&
    manifest.hasMoreCandidates === summary.hasMoreCandidates
  )
}

export async function cleanupExpiredStorageOrphanGcPreview(): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ key: instanceSetting.key, value: instanceSetting.value })
      .from(instanceSetting)
      .where(
        inArray(instanceSetting.key, [
          STORAGE_GC_SUMMARY_KEY,
          STORAGE_GC_MANIFEST_KEY,
          STORAGE_GC_CONFIRMATION_KEY,
        ]),
      )
      .for("update")
    const values = new Map(rows.map((row) => [row.key, row.value]))
    const summary = safeParse(
      AdminStorageGcSummarySchema,
      values.get(STORAGE_GC_SUMMARY_KEY),
    )
    if (
      !summary.success ||
      summary.data.mode !== "preview" ||
      !summary.data.confirmationExpiresAt ||
      Date.now() < new Date(summary.data.confirmationExpiresAt).getTime()
    ) {
      return
    }

    const confirmation = safeParse(
      StorageGcConfirmationSchema,
      values.get(STORAGE_GC_CONFIRMATION_KEY),
    )
    if (
      confirmation.success &&
      confirmation.data.previewJobId === summary.data.previewJobId
    ) {
      const [liveDelete] = await tx
        .select({ id: job.id })
        .from(job)
        .where(
          and(
            eq(job.id, confirmation.data.jobId),
            eq(job.kind, STORAGE_ORPHAN_GC_KIND),
            inArray(job.status, ["pending", "running"]),
          ),
        )
        .limit(1)
      if (liveDelete) return
    }

    const manifest = safeParse(
      StorageGcManifestSchema,
      values.get(STORAGE_GC_MANIFEST_KEY),
    )
    if (
      manifest.success &&
      manifest.data.previewJobId === summary.data.previewJobId &&
      manifest.data.cutoffAt === summary.data.cutoffAt &&
      manifestMatchesSummary(manifest.data, summary.data)
    ) {
      await tx
        .delete(instanceSetting)
        .where(eq(instanceSetting.key, STORAGE_GC_MANIFEST_KEY))
    }
    if (
      confirmation.success &&
      confirmation.data.previewJobId === summary.data.previewJobId
    ) {
      await tx
        .delete(instanceSetting)
        .where(eq(instanceSetting.key, STORAGE_GC_CONFIRMATION_KEY))
    }
  })
}

async function runStorageOrphanGc(
  payload: StorageOrphanGcPayload,
  ctx: JobHandlerContext,
): Promise<void> {
  if (payload.mode === "preview") {
    await runStorageOrphanGcPreview(ctx)
    return
  }
  await runConfirmedStorageOrphanGc(payload, ctx)
}

async function handleStorageOrphanGcFailed(
  payload: StorageOrphanGcPayload,
  _error: Error,
  ctx: JobFailureContext,
): Promise<void> {
  if (payload.mode === "preview" || ctx.willRetry) return

  const rows = await ctx.tx
    .select({ key: instanceSetting.key, value: instanceSetting.value })
    .from(instanceSetting)
    .where(
      inArray(instanceSetting.key, [
        STORAGE_GC_SUMMARY_KEY,
        STORAGE_GC_MANIFEST_KEY,
        STORAGE_GC_CONFIRMATION_KEY,
      ]),
    )
    .for("update")
  const values = new Map(rows.map((row) => [row.key, row.value]))
  const storedSummary = safeParse(
    AdminStorageGcSummarySchema,
    values.get(STORAGE_GC_SUMMARY_KEY),
  )
  const manifest = safeParse(
    StorageGcManifestSchema,
    values.get(STORAGE_GC_MANIFEST_KEY),
  )
  const confirmation = safeParse(
    StorageGcConfirmationSchema,
    values.get(STORAGE_GC_CONFIRMATION_KEY),
  )
  const accurateSummary =
    storedSummary.success &&
    storedSummary.data.mode === "delete" &&
    storedSummary.data.jobId === ctx.jobId &&
    storedSummary.data.previewJobId === payload.previewJobId &&
    storedSummary.data.cutoffAt === payload.cutoffAt &&
    storedSummary.data.deleteFailures > 0
      ? storedSummary.data
      : null
  const matchingManifest =
    manifest.success &&
    manifest.data.previewJobId === payload.previewJobId &&
    manifest.data.cutoffAt === payload.cutoffAt
      ? manifest.data
      : null
  if (
    !storedSummary.success ||
    summaryBelongsToFailedDelete(storedSummary.data, payload, ctx.jobId)
  ) {
    await writeStorageMaintenanceSummary(
      STORAGE_GC_SUMMARY_KEY,
      AdminStorageGcSummarySchema.parse(
        accurateSummary ??
          createTerminalFailureSummary(payload, matchingManifest, ctx.jobId),
      ),
      ctx.tx,
    )
  }
  if (matchingManifest) {
    await ctx.tx
      .delete(instanceSetting)
      .where(eq(instanceSetting.key, STORAGE_GC_MANIFEST_KEY))
  }
  if (
    confirmation.success &&
    confirmation.data.previewJobId === payload.previewJobId &&
    confirmation.data.jobId === ctx.jobId
  ) {
    await ctx.tx
      .delete(instanceSetting)
      .where(eq(instanceSetting.key, STORAGE_GC_CONFIRMATION_KEY))
  }
}

function summaryBelongsToFailedDelete(
  summary: t.infer<typeof AdminStorageGcSummarySchema>,
  payload: Extract<StorageOrphanGcPayload, { mode: "delete" }>,
  jobId: string,
): boolean {
  if (
    summary.previewJobId !== payload.previewJobId ||
    summary.cutoffAt !== payload.cutoffAt
  ) {
    return false
  }
  if (summary.mode === "preview") return summary.jobId === payload.previewJobId
  return summary.jobId === jobId
}

function createTerminalFailureSummary(
  payload: Extract<StorageOrphanGcPayload, { mode: "delete" }>,
  manifest: StorageGcManifest | null,
  jobId: string,
): StorageGcSummary {
  return {
    ...createStorageGcSummary({
      jobId,
      previewJobId: payload.previewJobId,
      mode: "delete",
      cutoffAt: payload.cutoffAt,
    }),
    orphanCandidates:
      manifest?.candidates.filter((candidate) => candidate.kind === "orphan")
        .length ?? 0,
    staleAssetCandidates:
      manifest?.candidates.filter((candidate) => candidate.kind === "stale")
        .length ?? 0,
    hasMoreCandidates: manifest?.hasMoreCandidates ?? false,
    deleteFailures: 1,
  }
}

async function runStorageOrphanGcPreview(
  ctx: JobHandlerContext,
): Promise<void> {
  const cutoffAt = new Date(Date.now() - ORPHAN_SAFETY_MARGIN_MS).toISOString()
  const manifest: StorageGcManifest = {
    previewJobId: ctx.jobId,
    cutoffAt,
    hasMoreCandidates: false,
    candidates: [],
  }
  const summary = createStorageGcSummary({
    jobId: ctx.jobId,
    previewJobId: ctx.jobId,
    mode: "preview",
    cutoffAt,
  })
  let page: GcEntry[] = []

  for await (const entry of listGcEntries()) {
    if (ctx.signal.aborted) break
    page.push(entry)
    if (page.length < PAGE_SIZE) continue
    const reachedLimit = await processPreviewPage(
      page,
      summary,
      manifest,
      ctx.signal,
    )
    page = []
    if (reachedLimit) break
  }

  if (!ctx.signal.aborted && !manifest.hasMoreCandidates && page.length > 0) {
    await processPreviewPage(page, summary, manifest, ctx.signal)
  }
  if (ctx.signal.aborted) return

  const validatedManifest = StorageGcManifestSchema.parse(manifest)
  summary.orphanCandidates = validatedManifest.candidates.filter(
    (candidate) => candidate.kind === "orphan",
  ).length
  summary.staleAssetCandidates = validatedManifest.candidates.filter(
    (candidate) => candidate.kind === "stale",
  ).length
  const finishedAt = new Date()
  summary.finishedAt = finishedAt.toISOString()
  summary.confirmationExpiresAt = new Date(
    finishedAt.getTime() + PREVIEW_CONFIRMATION_MAX_AGE_MS,
  ).toISOString()
  const stored = await withActiveStorageGcLease(ctx, async (tx) => {
    await writeStorageMaintenanceSummary(STORAGE_GC_SUMMARY_KEY, summary, tx)
    await writeStorageMaintenanceSummary(
      STORAGE_GC_MANIFEST_KEY,
      validatedManifest,
      tx,
    )
    await tx
      .delete(instanceSetting)
      .where(eq(instanceSetting.key, STORAGE_GC_CONFIRMATION_KEY))
  })
  if (!stored) return
  logStorageGcSummary(summary)
}

async function runConfirmedStorageOrphanGc(
  payload: Extract<StorageOrphanGcPayload, { mode: "delete" }>,
  ctx: JobHandlerContext,
): Promise<void> {
  const manifest = await readStorageGcManifest()
  if (
    !manifest ||
    manifest.previewJobId !== payload.previewJobId ||
    manifest.cutoffAt !== payload.cutoffAt
  ) {
    throw new Error("Storage cleanup preview is no longer available.")
  }
  const summary = createStorageGcSummary({
    jobId: ctx.jobId,
    previewJobId: payload.previewJobId,
    mode: "delete",
    cutoffAt: payload.cutoffAt,
  })
  summary.orphanCandidates = manifest.candidates.filter(
    (candidate) => candidate.kind === "orphan",
  ).length
  summary.staleAssetCandidates = manifest.candidates.filter(
    (candidate) => candidate.kind === "stale",
  ).length
  summary.hasMoreCandidates = manifest.hasMoreCandidates

  for (const candidate of manifest.candidates) {
    if (ctx.signal.aborted) return
    summary.scanned += 1
    await deleteManifestCandidate(candidate, summary, ctx.signal)
  }
  if (ctx.signal.aborted) return

  summary.finishedAt = new Date().toISOString()
  if (summary.deleteFailures > 0) {
    const stored = await withActiveStorageGcLease(ctx, (tx) =>
      writeStorageMaintenanceSummary(STORAGE_GC_SUMMARY_KEY, summary, tx),
    )
    if (!stored) return
    logStorageGcSummary(summary)
    throw new Error(
      `Storage cleanup failed to delete ${summary.deleteFailures} objects.`,
    )
  }

  const stored = await withActiveStorageGcLease(ctx, async (tx) => {
    await writeStorageMaintenanceSummary(STORAGE_GC_SUMMARY_KEY, summary, tx)
    await tx
      .delete(instanceSetting)
      .where(
        inArray(instanceSetting.key, [
          STORAGE_GC_MANIFEST_KEY,
          STORAGE_GC_CONFIRMATION_KEY,
        ]),
      )
  })
  if (!stored) return
  logStorageGcSummary(summary)
}

async function withActiveStorageGcLease(
  ctx: JobHandlerContext,
  write: (tx: JobTransaction) => Promise<void>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [activeJob] = await tx
      .select({ id: job.id })
      .from(job)
      .where(leasedRunningJob(ctx.jobId, ctx.runId))
      .for("update")
      .limit(1)
    if (!activeJob) return false
    await write(tx)
    return true
  })
}

function createStorageGcSummary(input: {
  jobId: string
  previewJobId: string
  mode: StorageGcSummary["mode"]
  cutoffAt: string
}): StorageGcSummary {
  return {
    ...input,
    finishedAt: new Date().toISOString(),
    confirmationExpiresAt: null,
    hasMoreCandidates: false,
    scanned: 0,
    orphanCandidates: 0,
    staleAssetCandidates: 0,
    deletedOrphanObjects: 0,
    deletedStaleAssets: 0,
    deleteFailures: 0,
  }
}

async function readStorageGcManifest(): Promise<StorageGcManifest | null> {
  const [row] = await db
    .select({ value: instanceSetting.value })
    .from(instanceSetting)
    .where(eq(instanceSetting.key, STORAGE_GC_MANIFEST_KEY))
  const parsed = safeParse(StorageGcManifestSchema, row?.value)
  return parsed.success ? parsed.data : null
}

function logStorageGcSummary(summary: StorageGcSummary): void {
  logger.info(
    `storage orphan gc ${summary.mode} complete: scanned=${summary.scanned} orphanCandidates=${summary.orphanCandidates} staleAssetCandidates=${summary.staleAssetCandidates} deletedOrphanObjects=${summary.deletedOrphanObjects} deletedStaleAssets=${summary.deletedStaleAssets} deleteFailures=${summary.deleteFailures}`,
  )
}

async function* listGcEntries(): AsyncIterable<GcEntry> {
  // Deliberately limited to parsed clip-owned asset keys. Copy fallback
  // `*.tmp` files and crashed `uploads/` completion debris can leak, but they
  // are not safely attributable to a committed clip yet and need a separate
  // policy before GC widens its deletion scope.
  for await (const entry of clipStorage.list("")) {
    yield { ...entry, storage: clipStorage, storageKind: "clip" }
  }
  for await (const entry of clipThumbnailStorage.list("")) {
    yield {
      ...entry,
      storage: clipThumbnailStorage,
      storageKind: "thumbnail",
    }
  }
}

async function processPreviewPage(
  page: GcEntry[],
  summary: StorageGcSummary,
  manifest: StorageGcManifest,
  signal: AbortSignal,
): Promise<boolean> {
  const parsed = page.map((entry) => ({
    entry,
    parsed: parseClipStorageKey(entry.key),
  }))
  const clipIds = [
    ...new Set(
      parsed
        .map((item) => item.parsed?.clipId)
        .filter((clipId): clipId is string => Boolean(clipId)),
    ),
  ]
  const rows = await selectGcClipRows(clipIds)
  const liveKeys = await selectLiveKeys(clipIds, rows)
  const cutoff = new Date(summary.cutoffAt).getTime()

  for (const item of parsed) {
    if (signal.aborted) return false
    summary.scanned += 1
    if (!item.parsed) continue
    if (!olderThan(item.entry.lastModified, cutoff)) continue
    const row = rows.get(item.parsed.clipId)
    if (!row) {
      if (addManifestCandidate(manifest, item.entry, "orphan")) return true
      continue
    }
    // An active encode lease brackets publish-to-commit. During that window a
    // freshly published object may not be in the clip row yet, so stale-asset
    // deletion must wait for a later sweep.
    if (row.encodeRunId !== null) continue
    if (liveKeys.get(row.id)?.has(item.entry.key)) continue
    if (!isCollectableAsset(item.entry, item.parsed.filename)) continue
    if (addManifestCandidate(manifest, item.entry, "stale")) return true
  }
  return false
}

function addManifestCandidate(
  manifest: StorageGcManifest,
  entry: GcEntry,
  kind: StorageGcCandidate["kind"],
): boolean {
  if (manifest.candidates.length === STORAGE_GC_MAX_CANDIDATES) {
    manifest.hasMoreCandidates = true
    return true
  }
  manifest.candidates.push({ storage: entry.storageKind, key: entry.key, kind })
  return false
}

async function deleteManifestCandidate(
  candidate: StorageGcCandidate,
  summary: StorageGcSummary,
  signal: AbortSignal,
): Promise<void> {
  try {
    const entry = manifestEntry(candidate)
    const namespace = candidate.storage === "clip" ? "clips" : "thumbnails"
    const result = await deleteStorageGcCandidate(namespace, entry.key, {
      storage: entry.storage,
      classifyCurrent: async () =>
        (await classifyCurrentEntry(entry, summary.cutoffAt)) ===
        candidate.kind,
      isWriteActive: storageObjectWriteIsActive,
      hasLiveReference: storageDeletionHasLiveReference,
      signal,
    })
    if (result !== "deleted") return
    if (candidate.kind === "orphan") {
      summary.deletedOrphanObjects += 1
      return
    }
    summary.deletedStaleAssets += 1
  } catch (error) {
    summary.deleteFailures += 1
    logger.error(
      `storage orphan gc could not process ${candidate.storage}:${candidate.key}`,
      error,
    )
  }
}

function manifestEntry(candidate: StorageGcCandidate): GcEntry {
  return {
    key: candidate.key,
    lastModified: null,
    storage: candidate.storage === "clip" ? clipStorage : clipThumbnailStorage,
    storageKind: candidate.storage,
  }
}

async function classifyCurrentEntry(
  entry: GcEntry,
  cutoffAt: string,
): Promise<"orphan" | "stale" | null> {
  const parsed = parseClipStorageKey(entry.key)
  if (!parsed) return null
  const resolved = await entry.storage.resolve(entry.key)
  if (
    !resolved ||
    !olderThan(resolved.lastModified, new Date(cutoffAt).getTime())
  ) {
    return null
  }
  const rows = await selectGcClipRows([parsed.clipId])
  const row = rows.get(parsed.clipId)
  if (!row) return "orphan"
  if (row.encodeRunId !== null) return null
  const liveKeys = await selectLiveKeys([parsed.clipId], rows)
  if (liveKeys.get(row.id)?.has(entry.key)) return null
  return isCollectableAsset(entry, parsed.filename) ? "stale" : null
}

async function selectGcClipRows(
  clipIds: string[],
): Promise<Map<string, GcClipRow>> {
  if (clipIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: clip.id,
      sourceKey: clip.source_key,
      waveformKey: clip.waveform_key,
      cutKey: clip.cut_key,
      thumbKey: clip.thumb_key,
      encodeRunId: clip.encode_run_id,
    })
    .from(clip)
    .where(inArray(clip.id, clipIds))
  return new Map(rows.map((row) => [row.id, row]))
}

async function selectLiveKeys(
  clipIds: string[],
  rows: Map<string, GcClipRow>,
): Promise<Map<string, Set<string>>> {
  const liveKeys = new Map<string, Set<string>>()
  for (const row of rows.values()) {
    liveKeys.set(row.id, new Set(staticLiveKeys(row)))
  }
  if (clipIds.length === 0) return liveKeys

  const renditions = await db
    .select({
      clipId: clipRendition.clip_id,
      storageKey: clipRendition.storage_key,
    })
    .from(clipRendition)
    .where(inArray(clipRendition.clip_id, clipIds))
  for (const rendition of renditions) {
    liveKeys.get(rendition.clipId)?.add(rendition.storageKey)
  }
  const audioTracks = await db
    .select({
      clipId: clipAudioTrack.clip_id,
      storageKey: clipAudioTrack.storage_key,
    })
    .from(clipAudioTrack)
    .where(inArray(clipAudioTrack.clip_id, clipIds))
  for (const track of audioTracks) {
    liveKeys.get(track.clipId)?.add(track.storageKey)
  }
  return liveKeys
}

function staticLiveKeys(row: GcClipRow): string[] {
  return [
    row.sourceKey,
    row.waveformKey,
    row.cutKey,
    row.thumbKey,
    clipAssetKey(row.id, "thumb"),
    clipAssetKey(row.id, "thumb-small"),
  ].filter((key): key is string => Boolean(key))
}

function parseClipStorageKey(key: string): ParsedStorageKey | null {
  const match =
    /^([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([^/]+)$/i.exec(
      key,
    )
  if (!match) return null
  const clipId = match[3]
  if (!clipId) return null
  if (key.slice(0, key.lastIndexOf("/")) !== clipAssetDir(clipId)) return null
  return { clipId, filename: match[4] ?? "" }
}

function isRunStampedFilename(filename: string): boolean {
  return (
    /^source-[0-9a-f]{12}$/i.test(filename) ||
    /^waveform-[0-9a-f]{12}\.m4a$/i.test(filename) ||
    /^cut-[0-9a-f]{12}\.mp4$/i.test(filename) ||
    /^rendition-.+-[0-9a-f]{12}\.mp4$/i.test(filename) ||
    AUDIO_TRACK_ASSET_RE.test(filename) ||
    /^thumb-[0-9a-f]{12}\.jpg$/i.test(filename)
  )
}

function isCollectableAsset(entry: GcEntry, filename: string): boolean {
  // The thumbnail namespace contains derived clip images only. Any old key
  // that is not in the complete live-key set is safe to collect.
  return entry.storageKind === "thumbnail" || isRunStampedFilename(filename)
}

function olderThan(lastModified: Date | null, cutoff: number): boolean {
  return lastModified !== null && lastModified.getTime() < cutoff
}
