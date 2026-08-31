import { createLogger } from "@alloy/logging"
import { client } from "@alloy/server/db/index"

const logger = createLogger("upload-deadline")

const REPAIR_BATCH_SIZE = 500

/**
 * Legacy upload timestamps are timestamp-without-time-zone values written as
 * UTC. Convert them explicitly before deriving the new timestamptz deadline.
 * Candidate selection and the update are both bounded and the update repeats
 * the pending/null ownership predicate.
 */
export const LEGACY_UPLOAD_DEADLINE_REPAIR_SQL = `
  with candidates as (
    select id, created_at
    from clip
    where status = 'pending'
      and upload_cleanup_at is null
    order by created_at, id
    limit $2
  ),
  raw_deadlines as (
    select
      candidates.id,
      coalesce(
        max(
          case
            when upload_ticket.used_at is null
              then upload_ticket.expires_at at time zone 'UTC'
            else greatest(
              upload_ticket.expires_at at time zone 'UTC',
              (upload_ticket.used_at at time zone 'UTC')
                + $1::double precision * interval '1 second'
            )
          end
        ),
        (candidates.created_at at time zone 'UTC')
          + $1::double precision * interval '1 second'
      ) as cleanup_at
    from candidates
    left join upload_ticket
      on upload_ticket.target_type = 'clip'
      and upload_ticket.target_id = candidates.id
    group by candidates.id, candidates.created_at
  ),
  deadlines as (
    select
      id,
      date_trunc('milliseconds', cleanup_at)
        + case
            when cleanup_at > date_trunc('milliseconds', cleanup_at)
              then interval '1 millisecond'
            else interval '0 milliseconds'
          end as cleanup_at
    from raw_deadlines
  )
  update clip
  set upload_cleanup_at = deadlines.cleanup_at
  from deadlines
  where clip.id = deadlines.id
    and clip.status = 'pending'
    and clip.upload_cleanup_at is null
  returning clip.id
`

export function uploadTicketDeadline(expiresAtEpochSec: number): Date {
  return new Date(expiresAtEpochSec * 1000)
}

export function completedUploadDeadline(
  usedAt: Date,
  uploadTtlSec: number,
): Date {
  return new Date(usedAt.getTime() + uploadTtlSec * 1000)
}

export function completedUploadMatches(
  object: { size: number; contentType: string },
  expected: { bytes: number; contentType: string },
): boolean {
  return (
    object.size === expected.bytes &&
    object.contentType === expected.contentType
  )
}

/** A terminal completion CAS may lose only because its exact ticket won first. */
export function completedUploadPersistenceSatisfied(
  adopted: boolean,
  refreshed: { usedAt: Date | null } | null,
): boolean {
  return adopted || (refreshed !== null && refreshed.usedAt !== null)
}

export type PendingUploadFinalizationAction = "recover" | "usable" | "expired"

/**
 * Exact bytes can close an unused ticket's storage-to-DB crash window even
 * after its original expiry. A used ticket never receives a second grace.
 */
export function pendingUploadFinalizationAction(
  ticket: {
    expectedBytes: number
    contentType: string
    expiresAt: Date
    usedAt: Date | null
  },
  object: { size: number; contentType: string },
  uploadCleanupAt: Date | null,
  now: Date,
): PendingUploadFinalizationAction {
  if (
    ticket.usedAt === null &&
    completedUploadMatches(object, {
      bytes: ticket.expectedBytes,
      contentType: ticket.contentType,
    })
  ) {
    return "recover"
  }
  return uploadTicketCanFinalize(ticket, uploadCleanupAt, now)
    ? "usable"
    : "expired"
}

export function uploadTicketCanFinalize(
  ticket: { expiresAt: Date; usedAt: Date | null },
  uploadCleanupAt: Date | null,
  now: Date,
): boolean {
  if (ticket.usedAt === null) return ticket.expiresAt.getTime() > now.getTime()
  return uploadCleanupAt !== null && uploadCleanupAt.getTime() > now.getTime()
}

export function uploadTicketCanAcceptBytes(
  ticket: { expiresAt: Date; usedAt: Date | null },
  tokenExpired: boolean,
  now: Date,
): boolean {
  return (
    !tokenExpired &&
    ticket.usedAt === null &&
    ticket.expiresAt.getTime() > now.getTime()
  )
}

export function pendingUploadCleanupStillDue(input: {
  selectedDeadline: Date
  currentDeadline: Date | null
  dueAtLock: boolean
}): boolean {
  return (
    input.dueAtLock &&
    input.currentDeadline?.getTime() === input.selectedDeadline.getTime()
  )
}

interface RepairOptions {
  batchSize?: number
  repairBatch?: (uploadTtlSec: number, limit: number) => Promise<number>
}

/** Drain legacy null deadlines in bounded statements before accepting HTTP. */
export async function repairLegacyUploadDeadlines(
  uploadTtlSec: number,
  options: RepairOptions = {},
): Promise<number> {
  const batchSize = options.batchSize ?? REPAIR_BATCH_SIZE
  const repairBatch = options.repairBatch ?? repairDatabaseBatch
  let repaired = 0

  while (true) {
    const count = await repairBatch(uploadTtlSec, batchSize)
    repaired += count
    if (count < batchSize) break
  }

  if (repaired > 0) logger.info(`repaired legacy upload deadlines=${repaired}`)
  return repaired
}

async function repairDatabaseBatch(
  uploadTtlSec: number,
  limit: number,
): Promise<number> {
  const result = await client.query<{ id: string }>(
    LEGACY_UPLOAD_DEADLINE_REPAIR_SQL,
    [uploadTtlSec, limit],
  )
  return result.rowCount ?? result.rows.length
}
