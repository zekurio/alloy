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

export type UploadExpiryCandidateKind = "clip" | "ticket"

export interface UploadExpiryCandidate {
  kind: UploadExpiryCandidateKind
  id: string
  targetId: string
  deadline: Date
  /** Database time captured by the due scan, used by destructive CAS checks. */
  scanCutoff: Date
}

export interface UploadExpiryExclusions {
  clipIds: readonly string[]
  ticketIds: readonly string[]
}

/**
 * Bound each indexed partition before taking the globally earliest deadline.
 * upload_ticket timestamps predate the timestamptz convention, so both its
 * comparison and returned deadline explicitly interpret the value as UTC.
 */
export const UPLOAD_EXPIRY_DUE_SQL = `
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
export const UPLOAD_EXPIRY_NEXT_SQL = `
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

export interface UploadExpiryStore {
  selectDueCandidates(
    limit: number,
    exclusions: UploadExpiryExclusions,
    signal: AbortSignal,
  ): Promise<readonly UploadExpiryCandidate[]>
  selectNextExpiry(
    exclusions: UploadExpiryExclusions,
    signal: AbortSignal,
  ): Promise<Date | null>
  processCandidate(
    candidate: UploadExpiryCandidate,
    signal: AbortSignal,
  ): Promise<void>
}

export interface UploadExpiryCoordinatorOptions {
  store: UploadExpiryStore
  batchSize?: number
  reconciliationIntervalMs?: number
  errorRetryMs?: number
  candidateRetryMs?: number
  onError(cause: unknown): void
}

/** Single-process coordinator; database rows remain the durable work ledger. */
export class UploadExpiryCoordinator {
  readonly #batchSize: number
  readonly #candidateRetryMs: number
  readonly #onError: (cause: unknown) => void
  readonly #store: UploadExpiryStore
  readonly #worker: WakeableSerialWorker
  readonly #cooldownUntil = new Map<string, number>()

  constructor(options: UploadExpiryCoordinatorOptions) {
    this.#batchSize = options.batchSize ?? BATCH_SIZE
    this.#candidateRetryMs = options.candidateRetryMs ?? CANDIDATE_RETRY_MS
    this.#onError = options.onError
    this.#store = options.store
    this.#worker = new WakeableSerialWorker({
      reconciliationIntervalMs:
        options.reconciliationIntervalMs ?? RECONCILIATION_INTERVAL_MS,
      errorRetryMs: options.errorRetryMs ?? ERROR_RETRY_MS,
      runOne: (signal) => this.#runOne(signal),
      onError: options.onError,
    })
  }

  start(): void {
    this.#worker.start()
  }

  wake(): void {
    this.#worker.wake()
  }

  stop(): Promise<void> {
    return this.#worker.stop()
  }

  async #runOne(signal: AbortSignal) {
    if (signal.aborted) return { worked: false as const, nextRunAt: null }

    const exclusions = this.#activeExclusions()
    const candidates = await this.#store.selectDueCandidates(
      this.#batchSize,
      exclusions,
      signal,
    )
    if (signal.aborted) return { worked: false as const, nextRunAt: null }

    if (candidates.length === 0) {
      const now = Date.now()
      const earliestCooldown = this.#earliestCooldown()
      if (earliestCooldown && earliestCooldown.getTime() <= now) {
        // Keep every failed identity excluded for the complete forward drain,
        // even when a short cooldown expires while later batches are running.
        // Only re-arm due retries after no unrelated candidate remains.
        this.#releaseExpiredCooldowns(now)
        return { worked: true as const }
      }
      const nextExpiry = await this.#store.selectNextExpiry(exclusions, signal)
      return {
        worked: false as const,
        nextRunAt: earlierDate(nextExpiry, earliestCooldown),
      }
    }

    for (const candidate of candidates) {
      if (signal.aborted) break
      const identity = candidateIdentity(candidate)
      try {
        await this.#store.processCandidate(candidate, signal)
        this.#cooldownUntil.delete(identity)
      } catch (cause) {
        if (signal.aborted) break
        this.#recordFailure(identity)
        this.#onError(
          new UploadExpiryCandidateError(
            candidate.kind,
            candidate.id,
            toError(cause, "Upload expiry candidate failed"),
          ),
        )
      }
    }

    return signal.aborted
      ? { worked: false as const, nextRunAt: null }
      : { worked: true as const }
  }

  #activeExclusions(): UploadExpiryExclusions {
    const clipIds: string[] = []
    const ticketIds: string[] = []
    for (const identity of this.#cooldownUntil.keys()) {
      const separator = identity.indexOf(":")
      const kind = identity.slice(0, separator)
      const id = identity.slice(separator + 1)
      if (kind === "clip") clipIds.push(id)
      else if (kind === "ticket") ticketIds.push(id)
    }
    return { clipIds, ticketIds }
  }

  #releaseExpiredCooldowns(now: number): void {
    for (const [identity, retryAt] of this.#cooldownUntil) {
      if (retryAt <= now) this.#cooldownUntil.delete(identity)
    }
  }

  #recordFailure(identity: string): void {
    this.#cooldownUntil.set(identity, Date.now() + this.#candidateRetryMs)
  }

  #earliestCooldown(): Date | null {
    let earliest = Number.POSITIVE_INFINITY
    for (const retryAt of this.#cooldownUntil.values()) {
      earliest = Math.min(earliest, retryAt)
    }
    return Number.isFinite(earliest) ? new Date(earliest) : null
  }
}

export class UploadExpiryCandidateError extends Error {
  constructor(
    readonly kind: UploadExpiryCandidateKind,
    readonly candidateId: string,
    cause: Error,
  ) {
    super(`Could not clean expired upload ${kind}:${candidateId}`, {
      cause,
    })
  }
}

function candidateIdentity(candidate: UploadExpiryCandidate): string {
  return `${candidate.kind}:${candidate.id}`
}

function earlierDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right
  if (!right) return left
  return left.getTime() <= right.getTime() ? left : right
}

interface DueRow {
  kind: UploadExpiryCandidateKind
  id: string
  targetId: string
  deadline: Date
  scanCutoff: Date
}

const databaseStore: UploadExpiryStore = {
  async selectDueCandidates(limit, exclusions, signal) {
    if (signal.aborted) return []
    const result = await client.query<DueRow>(UPLOAD_EXPIRY_DUE_SQL, [
      limit,
      exclusions.clipIds,
      exclusions.ticketIds,
    ])
    return result.rows
  },
  async selectNextExpiry(exclusions, signal) {
    if (signal.aborted) return null
    const result = await client.query<{ nextRunAt: Date | null }>(
      UPLOAD_EXPIRY_NEXT_SQL,
      [exclusions.clipIds, exclusions.ticketIds],
    )
    return result.rows[0]?.nextRunAt ?? null
  },
  async processCandidate(candidate, signal) {
    if (signal.aborted) return
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
  },
}

const coordinator = new UploadExpiryCoordinator({
  store: databaseStore,
  onError: (cause) => logger.error("upload expiry coordinator failed:", cause),
})

export function startUploadExpiryWorker(): void {
  coordinator.start()
}

export function wakeUploadExpiryWorker(): void {
  coordinator.wake()
}

export function stopUploadExpiryWorker(): Promise<void> {
  return coordinator.stop()
}

/** Couple the low-latency wake to a successful atomic initiation commit. */
export async function commitUploadInitiateAndWake<T extends { ok: boolean }>(
  commit: () => Promise<T>,
  wake: () => void = wakeUploadExpiryWorker,
): Promise<T> {
  const result = await commit()
  if (result.ok) wake()
  return result
}
