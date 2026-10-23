import { clip } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { client, db } from "@alloy/server/db/index"
import { toError } from "@alloy/server/runtime/error-message"
import { WakeableSerialWorker } from "@alloy/server/runtime/wakeable-serial-worker"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { cleanupPendingUploadCandidate } from "@alloy/server/uploads/cleanup"
import { deleteExpiredUploadTicketWithStorageIntent } from "@alloy/server/uploads/tickets"
import { and, eq } from "drizzle-orm"

const logger = createLogger("upload-expiry")

const BATCH_SIZE = 100
const RECONCILIATION_INTERVAL_MS = 10 * 60 * 1000
const ERROR_RETRY_MS = 5_000
const CANDIDATE_RETRY_MS = 5_000

type UploadExpiryCandidateKind = "clip" | "ticket"

interface UploadExpiryCandidate {
  kind: UploadExpiryCandidateKind
  id: string
  targetId: string
  deadline: Date
  /** Destructive CAS checks must use the due scan's database time. */
  scanCutoff: Date
}

interface UploadExpiryExclusions {
  clipIds: readonly string[]
  ticketIds: readonly string[]
}

/**
 * Bound each indexed partition before taking the globally earliest deadline.
 * upload_ticket timestamps predate the timestamptz convention, so both its
 * comparison and returned deadline explicitly interpret the value as UTC.
 */
const UPLOAD_EXPIRY_DUE_SQL = `
  with clock as materialized (
    select now() as cutoff
  ), candidates as (
    (
      select
        'clip'::text as kind,
        clip.id,
        clip.id as target_id,
        clip.upload_cleanup_at as deadline
      from clip, clock
      where clip.status = 'pending'
        and clip.upload_cleanup_at is not null
        and clip.upload_cleanup_at <= clock.cutoff
        and not (clip.id = any($2::uuid[]))
      order by clip.upload_cleanup_at, clip.id
      limit $1
    )

    union all

    (
      select
        'ticket'::text as kind,
        upload_ticket.id,
        upload_ticket.target_id,
        upload_ticket.expires_at at time zone 'UTC' as deadline
      from upload_ticket, clock
      where upload_ticket.target_type = 'clip'
        and upload_ticket.used_at is null
        and upload_ticket.expires_at <= (clock.cutoff at time zone 'UTC')
        and not (upload_ticket.id = any($3::uuid[]))
        and not exists (
          select 1
          from clip owner
          where owner.id = upload_ticket.target_id
            and owner.status in ('pending', 'processing')
        )
      order by upload_ticket.expires_at, upload_ticket.id
      limit $1
    )
  )
  select
    candidates.kind,
    candidates.id,
    candidates.target_id as "targetId",
    candidates.deadline,
    clock.cutoff as "scanCutoff"
  from candidates
  cross join clock
  order by candidates.deadline, candidates.kind, candidates.id
  limit $1
`

/** Return the exact global deadline while skipping locally cooled identities. */
const UPLOAD_EXPIRY_NEXT_SQL = `
  with candidates as (
    (
      select
        'clip'::text as kind,
        clip.id,
        clip.upload_cleanup_at as deadline
      from clip
      where clip.status = 'pending'
        and clip.upload_cleanup_at is not null
        and not (clip.id = any($1::uuid[]))
      order by clip.upload_cleanup_at, clip.id
      limit 1
    )

    union all

    (
      select
        'ticket'::text as kind,
        upload_ticket.id,
        upload_ticket.expires_at at time zone 'UTC' as deadline
      from upload_ticket
      where upload_ticket.target_type = 'clip'
        and upload_ticket.used_at is null
        and not (upload_ticket.id = any($2::uuid[]))
        and not exists (
          select 1
          from clip owner
          where owner.id = upload_ticket.target_id
            and owner.status in ('pending', 'processing')
        )
      order by upload_ticket.expires_at, upload_ticket.id
      limit 1
    )
  )
  select deadline as "nextRunAt"
  from candidates
  order by deadline, kind, id
  limit 1
`

// Single-process coordinator; database rows remain the durable work ledger.
// A candidate that fails cleanup is skipped until its cooldown ends.
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

  const exclusions = activeExclusions()
  const candidates = await selectDueCandidates(exclusions)
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
    const nextExpiry = await selectNextExpiry(exclusions)
    return {
      worked: false as const,
      nextRunAt: earlierDate(nextExpiry, earliestCooldown),
    }
  }

  for (const candidate of candidates) {
    if (signal.aborted) break
    const identity = candidateIdentity(candidate)
    try {
      await processCandidate(candidate, signal)
      cooldownUntil.delete(identity)
    } catch (cause) {
      if (signal.aborted) break
      cooldownUntil.set(identity, Date.now() + CANDIDATE_RETRY_MS)
      reportError(
        new Error(
          `Could not clean expired upload ${candidate.kind}:${candidate.id}`,
          { cause: toError(cause, "Upload expiry candidate failed") },
        ),
      )
    }
  }

  return signal.aborted
    ? { worked: false as const, nextRunAt: null }
    : { worked: true as const }
}

function activeExclusions(): UploadExpiryExclusions {
  const clipIds: string[] = []
  const ticketIds: string[] = []
  for (const identity of cooldownUntil.keys()) {
    const separator = identity.indexOf(":")
    const kind = identity.slice(0, separator)
    const id = identity.slice(separator + 1)
    if (kind === "clip") clipIds.push(id)
    else if (kind === "ticket") ticketIds.push(id)
  }
  return { clipIds, ticketIds }
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

function candidateIdentity(candidate: UploadExpiryCandidate): string {
  return `${candidate.kind}:${candidate.id}`
}

function earlierDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right
  if (!right) return left
  return left.getTime() <= right.getTime() ? left : right
}

async function selectDueCandidates(
  exclusions: UploadExpiryExclusions,
): Promise<readonly UploadExpiryCandidate[]> {
  const result = await client.query<UploadExpiryCandidate>(
    UPLOAD_EXPIRY_DUE_SQL,
    [BATCH_SIZE, exclusions.clipIds, exclusions.ticketIds],
  )
  return result.rows
}

async function selectNextExpiry(
  exclusions: UploadExpiryExclusions,
): Promise<Date | null> {
  const result = await client.query<{ nextRunAt: Date | null }>(
    UPLOAD_EXPIRY_NEXT_SQL,
    [exclusions.clipIds, exclusions.ticketIds],
  )
  return result.rows[0]?.nextRunAt ?? null
}

async function processCandidate(
  candidate: UploadExpiryCandidate,
  signal: AbortSignal,
): Promise<void> {
  if (candidate.kind === "clip") {
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
    return
  }

  const queued = await withUploadActivityStopped(
    candidate.targetId,
    async () => {
      if (signal.aborted) return 0
      return db.transaction((tx) =>
        deleteExpiredUploadTicketWithStorageIntent(
          candidate.id,
          candidate.targetId,
          candidate.scanCutoff,
          "upload ticket expired",
          tx,
        ),
      )
    },
  )
  if (queued > 0) wakeStorageDeletionWorker()
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
