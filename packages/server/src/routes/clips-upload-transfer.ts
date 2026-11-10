import { t } from "@alloy/contracts/schema"
import { uploadTicket } from "@alloy/db/schema"
import { createLogger, runWithLogContext } from "@alloy/logging"
import { requireSession } from "@alloy/server/auth/session"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import {
  badRequest,
  gone,
  insufficientStorage,
  internalServerError,
  noContent,
  notFound,
  payloadTooLarge,
} from "@alloy/server/runtime/http-response"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import {
  UPLOAD_PART_SIZE_BYTES,
  UploadPartSizeMismatchError,
  UploadPartTooLargeError,
} from "@alloy/server/storage/fs-driver"
import { isOsErrorCode } from "@alloy/server/storage/fs-driver-helpers"
import { clipStorage } from "@alloy/server/storage/index"
import {
  withUploadActivity,
  withUploadActivityStopped,
} from "@alloy/server/uploads/activity"
import {
  completedUploadMatches,
  completedUploadPersistenceSatisfied,
  uploadTicketCanAcceptBytes,
} from "@alloy/server/uploads/deadline"
import {
  deleteUploadTicketWithStorageIntent,
  markUploadTicketUsedAndExtendDeadline,
  type SelectedUploadTicket,
  selectVideoTicket,
} from "@alloy/server/uploads/tickets"
import { eq } from "drizzle-orm"
import { type Context, Hono } from "hono"

import { IdParam, lowercaseUuid, tbValidator } from "./validation"

const logger = createLogger("uploads")

const UploadPartParam = t.object({
  id: lowercaseUuid(),
  partNumber: t.string(),
})

/**
 * "unused" admits only a ticket that can still take bytes; "terminal" also
 * admits a used one, so a repeated `complete` can answer for bytes that are
 * already in place.
 */
type UploadTicketLookupMode = "terminal" | "unused"

/**
 * The source upload of a clip the session's user is creating, sent in
 * numbered parts and then completed. The ticket row from initiate holds the
 * storage key, content type and size; the session decides whose it is.
 */
export const clipsUploadTransferRoutes = new Hono()
  .put(
    "/:id/upload/chunks/:partNumber",
    requireSession,
    tbValidator("param", UploadPartParam),
    (c) => {
      const { id, partNumber: rawPartNumber } = c.req.valid("param")
      return withClipUploadTicket(
        c,
        id,
        c.var.viewerId,
        withUploadActivity,
        "unused",
        async (ticket) => {
          const partNumber = parsePartNumber(rawPartNumber)
          if (!partNumber) return badRequest(c, "Invalid upload part number")
          if (
            !partNumberInRange(
              partNumber,
              UPLOAD_PART_SIZE_BYTES,
              ticket.expectedBytes,
            )
          ) {
            return badRequest(c, "Upload part is outside declared size")
          }
          if (!c.req.raw.body) return badRequest(c, "Empty upload body")

          try {
            await clipStorage.writeUploadPart({
              key: ticket.storageKey,
              partNumber,
              partSizeBytes: UPLOAD_PART_SIZE_BYTES,
              maxBytes: ticket.expectedBytes,
              body: c.req.raw.body,
            })
          } catch (err) {
            if (err instanceof UploadPartTooLargeError) {
              return payloadTooLarge(c, "Upload part exceeded declared size")
            }
            if (
              err instanceof UploadPartSizeMismatchError &&
              !c.req.raw.signal.aborted
            ) {
              logger.warn(`upload part ${partNumber} was short:`, err)
              return badRequest(c, "Upload part did not match declared size")
            }
            return uploadWriteFailed(c, err, "Upload part write failed")
          }
          return noContent(c)
        },
      )
    },
  )
  .post(
    "/:id/upload/complete",
    requireSession,
    tbValidator("param", IdParam),
    (c) =>
      withClipUploadTicket(
        c,
        c.req.valid("param").id,
        c.var.viewerId,
        withUploadActivityStopped,
        "terminal",
        async (ticket) => {
          const expected = {
            bytes: ticket.expectedBytes,
            contentType: ticket.contentType,
          }
          const existing = await clipStorage.resolve(ticket.storageKey)
          const exactExisting =
            existing && completedUploadMatches(existing, expected)
          if (existing && !exactExisting) {
            return badRequest(c, "Upload destination contains unexpected bytes")
          }

          if (exactExisting) {
            if (ticket.usedAt === null) {
              await persistCompletedUpload(ticket.id)
            }
            return noContent(c)
          }

          if (!uploadTicketCanAcceptBytes(ticket, new Date())) {
            return ticketClosed(c)
          }

          try {
            await clipStorage.completeUpload({
              key: ticket.storageKey,
              maxBytes: ticket.expectedBytes,
              partSizeBytes: UPLOAD_PART_SIZE_BYTES,
            })
          } catch (err) {
            // Completion may have durably renamed the object before a tail
            // operation or prior DB adoption failed. Accept only the exact
            // staged object so retry can finish the ownership handoff.
            const recovered = await clipStorage.resolve(ticket.storageKey)
            if (!recovered || !completedUploadMatches(recovered, expected)) {
              if (isDiskFull(err)) return storageFull(c, err)
              logger.error("upload completion failed:", err)
              return badRequest(c, "Upload could not be completed")
            }
          }

          await persistCompletedUpload(ticket.id)
          return noContent(c)
        },
      ),
  )
  .delete("/:id/upload", requireSession, tbValidator("param", IdParam), (c) =>
    withClipUploadTicket(
      c,
      c.req.valid("param").id,
      c.var.viewerId,
      withUploadActivityStopped,
      "unused",
      async (ticket) => {
        const queued = await db.transaction((tx) =>
          deleteUploadTicketWithStorageIntent(
            ticket.id,
            "upload cancelled",
            tx,
          ),
        )
        if (queued > 0) wakeStorageDeletionWorker()
        return noContent(c)
      },
    ),
  )

/**
 * Runs `operation` on the clip's upload ticket under the clip's upload gate.
 * Only the user who initiated the upload owns its ticket, so another user's
 * clip answers exactly like a clip that does not exist.
 */
function withClipUploadTicket(
  c: Context,
  clipId: string,
  viewerId: string,
  gate: typeof withUploadActivity,
  lookupMode: UploadTicketLookupMode,
  operation: (ticket: SelectedUploadTicket) => Promise<Response>,
): Promise<Response> {
  return gate(clipId, async () => {
    const ticket = await selectVideoTicket(clipId, { ownerId: viewerId })
    if (!ticket) return notFound(c)
    if (
      lookupMode === "unused" &&
      !uploadTicketCanAcceptBytes(ticket, new Date())
    ) {
      return ticketClosed(c)
    }
    return runWithLogContext(
      { ticket: ticket.id, clip: clipId, key: ticket.storageKey },
      () => operation(ticket),
    )
  })
}

function ticketClosed(c: Context): Response {
  return gone(c, "Upload ticket has expired or already been used")
}

/**
 * Answer a failed upload write by its cause: a client that went away gets no
 * error log, a full disk is the server's to fix (507), anything else is 500.
 */
function uploadWriteFailed(
  c: Context,
  cause: unknown,
  message: string,
): Response {
  if (clientDisconnected(c, cause)) {
    logger.info("upload stopped: the client disconnected mid-stream")
    return badRequest(c, "Upload was interrupted")
  }
  if (isDiskFull(cause)) return storageFull(c, cause)
  logger.error(`${message}:`, cause)
  return internalServerError(c, message)
}

function storageFull(c: Context, cause: unknown): Response {
  logger.error("upload rejected, storage is full:", cause)
  return insufficientStorage(c, "The server is out of storage space")
}

function isDiskFull(cause: unknown): boolean {
  return isOsErrorCode(cause, "ENOSPC") || isOsErrorCode(cause, "EDQUOT")
}

function clientDisconnected(c: Context, cause: unknown): boolean {
  return (
    c.req.raw.signal.aborted ||
    isOsErrorCode(cause, "ECONNRESET") ||
    isOsErrorCode(cause, "ERR_STREAM_PREMATURE_CLOSE")
  )
}

function parsePartNumber(value: string): number | null {
  const partNumber = Number.parseInt(value, 10)
  return Number.isSafeInteger(partNumber) && partNumber > 0 ? partNumber : null
}

function partNumberInRange(
  partNumber: number,
  partSizeBytes: number,
  maxBytes: number,
): boolean {
  return (partNumber - 1) * partSizeBytes < maxBytes
}

async function persistCompletedUpload(ticketId: string): Promise<void> {
  const adopted = await markUploadTicketUsedAndExtendDeadline(
    ticketId,
    configStore.get("limits").uploadTtlSec,
  )
  if (adopted) return

  // The CAS lost: the ticket changed after this request read it. That is still
  // success when the ticket was durably completed in the meantime.
  const [refreshed] = await db
    .select({
      usedAt: uploadTicket.used_at,
    })
    .from(uploadTicket)
    .where(eq(uploadTicket.id, ticketId))
    .limit(1)
  if (!completedUploadPersistenceSatisfied(adopted, refreshed ?? null)) {
    throw new Error("Completed upload ownership changed")
  }
}
