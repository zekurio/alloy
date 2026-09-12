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
