import { clip } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { client, db } from "@alloy/server/db/index"
import { toError } from "@alloy/server/runtime/error-message"
import { WakeableSerialWorker } from "@alloy/server/runtime/wakeable-serial-worker"
import { cleanupPendingUploadCandidate } from "@alloy/server/uploads/cleanup"
import { and, eq } from "drizzle-orm"

const logger = createLogger("upload-expiry")

const BATCH_SIZE = 100
const RECONCILIATION_INTERVAL_MS = 10 * 60 * 1000
const ERROR_RETRY_MS = 5_000
const CANDIDATE_RETRY_MS = 5_000

/** A pending clip whose upload deadline has passed. */
interface UploadExpiryCandidate {
  id: string
  deadline: Date
}

// A ticket never outlives its pending clip: it is created with the clip, and
// finalizing, failing or deleting the clip uses or removes it in the same
// transaction. So the clip's deadline is the only one to watch.
const UPLOAD_EXPIRY_DUE_SQL = `
  select clip.id, clip.upload_cleanup_at as deadline
  from clip
  where clip.status = 'pending'
    and clip.upload_cleanup_at is not null
    and clip.upload_cleanup_at <= now()
    and not (clip.id = any($2::uuid[]))
  order by clip.upload_cleanup_at, clip.id
  limit $1
`

/** The next deadline, skipping clips that are cooling down after a failure. */
const UPLOAD_EXPIRY_NEXT_SQL = `
  select clip.upload_cleanup_at as "nextRunAt"
  from clip
  where clip.status = 'pending'
    and clip.upload_cleanup_at is not null
    and not (clip.id = any($1::uuid[]))
  order by clip.upload_cleanup_at, clip.id
  limit 1
`

// Single-process coordinator; database rows remain the durable work ledger.
// A clip that fails cleanup is skipped until its cooldown ends.
const cooldownUntil = new Map<string, number>()

const worker = new WakeableSerialWorker({
  reconciliationIntervalMs: RECONCILIATION_INTERVAL_MS,
  errorRetryMs: ERROR_RETRY_MS,
  runOne: runUploadExpiryPass,
  onError: reportError,
})

function reportError(cause: unknown): void {
  logger.error("upload expiry coordinator failed:", cause)
}

async function runUploadExpiryPass(signal: AbortSignal) {
  if (signal.aborted) return { worked: false as const, nextRunAt: null }

  const cooling = [...cooldownUntil.keys()]
  const candidates = await selectDueCandidates(cooling)
  if (signal.aborted) return { worked: false as const, nextRunAt: null }

  if (candidates.length === 0) {
    const now = Date.now()
    const earliestCooldown = earliestCooldownEnd()
    if (earliestCooldown && earliestCooldown.getTime() <= now) {
      // Keep every failed identity excluded for the complete forward drain,
      // even when a short cooldown expires while later batches are running.
      // Only re-arm due retries after no unrelated candidate remains.
      releaseExpiredCooldowns(now)
      return { worked: true as const }
    }
    const nextExpiry = await selectNextExpiry(cooling)
    return {
      worked: false as const,
      nextRunAt: earlierDate(nextExpiry, earliestCooldown),
    }
  }

  for (const candidate of candidates) {
    if (signal.aborted) break
    try {
      await processCandidate(candidate, signal)
      cooldownUntil.delete(candidate.id)
    } catch (cause) {
      if (signal.aborted) break
      cooldownUntil.set(candidate.id, Date.now() + CANDIDATE_RETRY_MS)
      reportError(
        new Error(`Could not clean expired upload of clip ${candidate.id}`, {
          cause: toError(cause, "Upload expiry candidate failed"),
        }),
      )
    }
  }

  return signal.aborted
    ? { worked: false as const, nextRunAt: null }
    : { worked: true as const }
}

function releaseExpiredCooldowns(now: number): void {
  for (const [identity, retryAt] of cooldownUntil) {
    if (retryAt <= now) cooldownUntil.delete(identity)
  }
}

function earliestCooldownEnd(): Date | null {
  let earliest = Number.POSITIVE_INFINITY
  for (const retryAt of cooldownUntil.values()) {
    earliest = Math.min(earliest, retryAt)
  }
  return Number.isFinite(earliest) ? new Date(earliest) : null
}

function earlierDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right
  if (!right) return left
  return left.getTime() <= right.getTime() ? left : right
}

async function selectDueCandidates(
  coolingClipIds: readonly string[],
): Promise<readonly UploadExpiryCandidate[]> {
  const result = await client.query<UploadExpiryCandidate>(
    UPLOAD_EXPIRY_DUE_SQL,
    [BATCH_SIZE, coolingClipIds],
  )
  return result.rows
}

async function selectNextExpiry(
  coolingClipIds: readonly string[],
): Promise<Date | null> {
  const result = await client.query<{ nextRunAt: Date | null }>(
    UPLOAD_EXPIRY_NEXT_SQL,
    [coolingClipIds],
  )
  return result.rows[0]?.nextRunAt ?? null
}

async function processCandidate(
  candidate: UploadExpiryCandidate,
  signal: AbortSignal,
): Promise<void> {
  const [row] = await db
    .select()
    .from(clip)
    .where(
      and(
        eq(clip.id, candidate.id),
        eq(clip.status, "pending"),
        eq(clip.upload_cleanup_at, candidate.deadline),
      ),
    )
    .limit(1)
  if (!row || signal.aborted) return
  await cleanupPendingUploadCandidate(
    row,
    // The mutable setting is read at execution so completed bytes receive
    // the same grace as an upload finishing through the HTTP route now.
    configStore.get("limits").uploadTtlSec,
  )
}

export function startUploadExpiryWorker(): void {
  worker.start()
}

export function stopUploadExpiryWorker(): Promise<void> {
  return worker.stop()
}

/** Couple the low-latency wake to a successful atomic initiation commit. */
export async function commitUploadInitiateAndWake<T extends { ok: boolean }>(
  commit: () => Promise<T>,
): Promise<T> {
  const result = await commit()
  if (result.ok) worker.wake()
  return result
}
