import { uploadTicket } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { secretStore } from "@alloy/server/config/secret-store"
import { db } from "@alloy/server/db/index"
import {
  badRequest,
  conflict,
  internalServerError,
  noContent,
  payloadTooLarge,
} from "@alloy/server/runtime/http-response"
import { clipStorageForUploadRole } from "@alloy/server/storage/index"
import { deleteStagedUpload } from "@alloy/server/uploads/staged"
import { and, eq, gt, isNull } from "drizzle-orm"
import { Hono } from "hono"

import { decodeUploadToken, UploadPartTooLargeError } from "./fs-driver"
import type { UploadTokenMode, UploadTokenPayload } from "./fs-upload-token"

const logger = createLogger("assets")

type UploadTicketRecord = {
  id: string
  role: "video" | "thumb"
}

type ResolvedUploadTicket = {
  payload: UploadTokenPayload
  mode: UploadTokenMode
  ticket: UploadTicketRecord
}

export const storageRoute = new Hono()
  .post("/upload/:token", async (c) => {
    const resolved = await resolveUploadTicket(c.req.param("token"), ["single"])
    if (resolved instanceof Response) return resolved
    const {
      payload: { k: key, ct: expectedContentType, mb: maxBytes },
      ticket,
    } = resolved
    const storage = clipStorageForUploadRole(ticket.role)

    const contentType = c.req.header("content-type")
    if (contentType && contentType !== expectedContentType) {
      return badRequest(c, "Content-Type does not match the upload ticket")
    }

    if (!c.req.raw.body) {
      return badRequest(c, "Empty upload body")
    }

    let limitTripped = false

    if (await storage.resolve(key)) {
      return conflict(c, "Upload ticket has already been used")
    }

    try {
      await storage.put(
        key,
        limitUploadBody(c.req.raw.body, maxBytes, () => {
          limitTripped = true
        }),
        expectedContentType,
      )
    } catch (err) {
      await deletePartialUpload(key, ticket.role)
      if (limitTripped) {
        return payloadTooLarge(c, "Upload exceeded declared size")
      }
      logger.error("upload write failed:", err)
      return internalServerError(c, "Upload write failed")
    }

    await markTicketUsed(ticket.id)
    return noContent(c)
  })
  .put("/upload/:token/chunks/:partNumber", async (c) => {
    const resolved = await resolveUploadTicket(c.req.param("token"), [
      "fs-chunked",
    ])
    if (resolved instanceof Response) return resolved
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
      await clipStorageForUploadRole(resolved.ticket.role).writeUploadPart({
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
  })
  .post("/upload/:token/complete", async (c) => {
    const resolved = await resolveUploadTicket(c.req.param("token"), [
      "fs-chunked",
    ])
    if (resolved instanceof Response) return resolved
    const { payload, ticket } = resolved
    const partSizeBytes = payload.cs
    if (!partSizeBytes) return badRequest(c, "Invalid upload ticket")

    try {
      await clipStorageForUploadRole(ticket.role).completeUpload({
        key: payload.k,
        contentType: payload.ct,
        maxBytes: payload.mb,
        partSizeBytes,
      })
    } catch (err) {
      logger.error("upload completion failed:", err)
      return badRequest(c, "Upload could not be completed")
    }

    await markTicketUsed(ticket.id)
    return noContent(c)
  })
  .delete("/upload/:token", async (c) => {
    const resolved = await resolveUploadTicket(c.req.param("token"), [
      "single",
      "fs-chunked",
    ])
    if (resolved instanceof Response) return resolved
    const { payload, ticket } = resolved
    await deleteStagedUpload(payload.k)
    await db.delete(uploadTicket).where(eq(uploadTicket.id, ticket.id))
    return noContent(c)
  })

async function resolveUploadTicket(
  token: string,
  allowedModes: readonly UploadTokenMode[],
): Promise<ResolvedUploadTicket | Response> {
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

  const [ticket] = await db
    .select({ id: uploadTicket.id, role: uploadTicket.role })
    .from(uploadTicket)
    .where(
      and(
        eq(uploadTicket.owner_id, payload.uid),
        eq(uploadTicket.target_id, payload.cid),
        eq(uploadTicket.storage_key, payload.k),
        eq(uploadTicket.content_type, payload.ct),
        eq(uploadTicket.expected_bytes, payload.mb),
        isNull(uploadTicket.used_at),
        gt(uploadTicket.expires_at, new Date()),
      ),
    )
    .limit(1)
  if (!ticket) {
    return unauthorizedResponse(
      "Upload ticket has expired or already been used",
    )
  }

  return { payload, mode, ticket }
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

async function markTicketUsed(ticketId: string): Promise<void> {
  await db
    .update(uploadTicket)
    .set({ used_at: new Date() })
    .where(eq(uploadTicket.id, ticketId))
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

async function deletePartialUpload(
  key: string,
  role: UploadTicketRecord["role"],
): Promise<void> {
  try {
    await clipStorageForUploadRole(role).delete(key)
  } catch (err) {
    logger.warn(`failed to remove partial upload ${key}:`, err)
  }
}
