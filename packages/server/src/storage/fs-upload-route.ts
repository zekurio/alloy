import { uploadTicket } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { secretStore } from "@alloy/server/config/secret-store"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import {
  badRequest,
  internalServerError,
  noContent,
  payloadTooLarge,
} from "@alloy/server/runtime/http-response"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { clipStorage } from "@alloy/server/storage/index"
import {
  withUploadActivity,
  withUploadActivityStopped,
} from "@alloy/server/uploads/activity"
import {
  completedUploadPersistenceSatisfied,
  completedUploadMatches,
  uploadTicketCanAcceptBytes,
} from "@alloy/server/uploads/deadline"
import {
  deleteUploadTicketWithStorageIntent,
  markUploadTicketUsedAndExtendDeadline,
} from "@alloy/server/uploads/tickets"
import { and, eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import { decodeUploadToken, UploadPartTooLargeError } from "./fs-driver"
import type { UploadTokenMode, UploadTokenPayload } from "./fs-upload-token"

const logger = createLogger("assets")

type UploadTicketRecord = {
  id: string
  expiresAt: Date
  usedAt: Date | null
}

type ResolvedUploadTicket = {
  payload: UploadTokenPayload
  mode: UploadTokenMode
  tokenExpired: boolean
  ticket: UploadTicketRecord
}

type DecodedUploadTicket = Omit<ResolvedUploadTicket, "ticket">
type UploadTicketLookupMode = "terminal" | "unused"

export const storageRoute = new Hono()
  .post("/upload/:token", (c) =>
    withResolvedUploadTicket(
      c.req.param("token"),
      ["single"],
      withUploadActivityStopped,
      "terminal",
      async (resolved) => {
        const {
          payload: { k: key, ct: expectedContentType, mb: maxBytes },
          ticket,
        } = resolved

        const existing = await clipStorage.resolve(key)
        const exactExisting =
          existing &&
          completedUploadMatches(existing, {
            bytes: maxBytes,
            contentType: expectedContentType,
          })
        if (exactExisting) {
          if (ticket.usedAt === null) {
            await persistCompletedUpload(ticket.id)
          }
          return noContent(c)
        }

        if (
          !uploadTicketCanAcceptBytes(ticket, resolved.tokenExpired, new Date())
        ) {
          return unauthorizedResponse("Upload ticket has expired or was used")
        }

        const contentType = c.req.header("content-type")
        if (contentType && contentType !== expectedContentType) {
          return badRequest(c, "Content-Type does not match the upload ticket")
        }

        if (!c.req.raw.body) {
          return badRequest(c, "Empty upload body")
        }

        let limitTripped = false

        if (existing) {
          // A crashed single-part write leaves its partial bytes at the final
          // unique key. Only a still-live unused ticket may replace it.
          await deletePartialUpload(key)
        }

        try {
          await clipStorage.put(
            key,
            limitUploadBody(c.req.raw.body, maxBytes, () => {
              limitTripped = true
            }),
            expectedContentType,
          )
        } catch (err) {
          await deletePartialUpload(key)
          if (limitTripped) {
            return payloadTooLarge(c, "Upload exceeded declared size")
          }
          logger.error("upload write failed:", err)
          return internalServerError(c, "Upload write failed")
        }

        await persistCompletedUpload(ticket.id)
        return noContent(c)
      },
    ),
  )
  .put("/upload/:token/chunks/:partNumber", (c) =>
    withResolvedUploadTicket(
      c.req.param("token"),
      ["fs-chunked"],
      withUploadActivity,
      "unused",
      async (resolved) => {
        const partNumber = parsePartNumber(c.req.param("partNumber"))
        if (!partNumber) return badRequest(c, "Invalid upload part number")
        const { payload } = resolved
        const partSizeBytes = payload.cs
        if (!partSizeBytes) return badRequest(c, "Invalid upload ticket")
        if (!partNumberInRange(partNumber, partSizeBytes, payload.mb)) {
          return badRequest(c, "Upload part is outside declared size")
        }
        if (!c.req.raw.body) return badRequest(c, "Empty upload body")

        try {
          await clipStorage.writeUploadPart({
            key: payload.k,
            partNumber,
            partSizeBytes,
            maxBytes: payload.mb,
            body: c.req.raw.body,
          })
        } catch (err) {
          if (err instanceof UploadPartTooLargeError) {
            return payloadTooLarge(c, "Upload part exceeded declared size")
          }
          logger.error("upload part write failed:", err)
          return badRequest(c, "Upload part did not match declared size")
        }
        return noContent(c)
      },
    ),
  )
  .post("/upload/:token/complete", (c) =>
    withResolvedUploadTicket(
      c.req.param("token"),
      ["fs-chunked"],
      withUploadActivityStopped,
      "terminal",
      async (resolved) => {
        const { payload, ticket } = resolved
        const partSizeBytes = payload.cs
        if (!partSizeBytes) return badRequest(c, "Invalid upload ticket")

        const existing = await clipStorage.resolve(payload.k)
        const exactExisting =
          existing &&
          completedUploadMatches(existing, {
            bytes: payload.mb,
            contentType: payload.ct,
          })
        if (existing && !exactExisting) {
          return badRequest(c, "Upload destination contains unexpected bytes")
        }

        if (exactExisting) {
          if (ticket.usedAt === null) {
            await persistCompletedUpload(ticket.id)
          }
          return noContent(c)
        }

        if (
          !uploadTicketCanAcceptBytes(ticket, resolved.tokenExpired, new Date())
        ) {
          return unauthorizedResponse("Upload ticket has expired or was used")
        }

        if (!existing) {
          try {
            await clipStorage.completeUpload({
              key: payload.k,
              contentType: payload.ct,
              maxBytes: payload.mb,
              partSizeBytes,
            })
          } catch (err) {
            // Completion may have durably renamed the object before a tail
            // operation or prior DB adoption failed. Accept only the exact
            // staged object so retry can finish the ownership handoff.
            const recovered = await clipStorage.resolve(payload.k)
            if (
              !recovered ||
              !completedUploadMatches(recovered, {
                bytes: payload.mb,
                contentType: payload.ct,
              })
            ) {
              logger.error("upload completion failed:", err)
              return badRequest(c, "Upload could not be completed")
            }
          }
        }

        await persistCompletedUpload(ticket.id)
        return noContent(c)
      },
    ),
  )
  .delete("/upload/:token", (c) =>
    withResolvedUploadTicket(
      c.req.param("token"),
      ["single", "fs-chunked"],
      withUploadActivityStopped,
      "unused",
      async ({ ticket }) => {
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

async function withResolvedUploadTicket(
  token: string,
  allowedModes: readonly UploadTokenMode[],
  gate: typeof withUploadActivity,
  lookupMode: UploadTicketLookupMode,
  operation: (resolved: ResolvedUploadTicket) => Promise<Response>,
): Promise<Response> {
  const decoded = await resolveUploadToken(token, allowedModes)
  if (decoded instanceof Response) return decoded
  return gate(decoded.payload.cid, async () => {
    const resolved = await selectUploadTicket(decoded, lookupMode)
    if (resolved instanceof Response) return resolved
    return operation(resolved)
  })
}

async function resolveUploadToken(
  token: string,
  allowedModes: readonly UploadTokenMode[],
): Promise<DecodedUploadTicket | Response> {
  const decoded = await decodeUploadToken(
    token,
    secretStore.get("uploadHmacSecret"),
  )
  if (!decoded.ok) {
    return unauthorizedResponse("Invalid upload ticket")
  }
  const payload = decoded.payload
  const mode = payload.m ?? "single"
  if (!allowedModes.includes(mode)) {
    return unauthorizedResponse("Upload ticket does not allow this operation")
  }

  return { payload, mode, tokenExpired: decoded.expired }
}

async function selectUploadTicket(
  decoded: DecodedUploadTicket,
  lookupMode: UploadTicketLookupMode,
): Promise<ResolvedUploadTicket | Response> {
  const { payload, mode, tokenExpired } = decoded
  const [ticket] = await db
    .select({
      id: uploadTicket.id,
      expiresAt: sql<Date>`${uploadTicket.expires_at} at time zone 'UTC'`,
      usedAt: sql<Date | null>`${uploadTicket.used_at} at time zone 'UTC'`,
    })
    .from(uploadTicket)
    .where(
      and(
        eq(uploadTicket.owner_id, payload.uid),
        eq(uploadTicket.target_type, "clip"),
        eq(uploadTicket.target_id, payload.cid),
        eq(uploadTicket.role, "video"),
        eq(uploadTicket.storage_key, payload.k),
        eq(uploadTicket.content_type, payload.ct),
        eq(uploadTicket.expected_bytes, payload.mb),
      ),
    )
    .limit(1)
  if (
    !ticket ||
    (lookupMode === "unused" &&
      !uploadTicketCanAcceptBytes(ticket, tokenExpired, new Date()))
  ) {
    return unauthorizedResponse(
      "Upload ticket has expired or already been used",
    )
  }

  return { payload, mode, tokenExpired, ticket }
}

function unauthorizedResponse(message: string): Response {
  return new Response(message, { status: 401 })
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

  // Upload activity is shared so duplicate terminal requests can both observe
  // an unused ticket. A losing CAS is still successful when the winner has
  // durably completed the same ticket in the meantime.
  const [refreshed] = await db
    .select({
      usedAt: sql<Date | null>`${uploadTicket.used_at} at time zone 'UTC'`,
    })
    .from(uploadTicket)
    .where(eq(uploadTicket.id, ticketId))
    .limit(1)
  if (!completedUploadPersistenceSatisfied(adopted, refreshed ?? null)) {
    throw new Error("Completed upload ownership changed")
  }
}

function limitUploadBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  onLimit: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let bytes = 0

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }

      bytes += value.byteLength
      if (bytes > maxBytes) {
        onLimit()
        await reader.cancel().catch(() => undefined)
        throw new Error("upload exceeded maxBytes")
      }

      controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

async function deletePartialUpload(key: string): Promise<void> {
  try {
    await clipStorage.delete(key)
  } catch (err) {
    logger.warn(`failed to remove partial upload ${key}:`, err)
  }
}
