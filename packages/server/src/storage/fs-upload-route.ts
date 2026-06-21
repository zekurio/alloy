import type { CompleteMultipartUploadPart } from "@alloy/contracts"
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
  unauthorized,
} from "@alloy/server/runtime/http-response"
import { clipStorage } from "@alloy/server/storage/index"
import {
  deleteStagedUpload,
  parseUploadTicketStorageState,
} from "@alloy/server/uploads/staged"
import { and, eq, gt, isNull } from "drizzle-orm"
import { Hono } from "hono"

import { decodeUploadToken, UploadPartTooLargeError } from "./fs-driver"
import type { UploadTokenMode, UploadTokenPayload } from "./fs-upload-token"

const logger = createLogger("assets")

type UploadTicketRecord = {
  id: string
  uploadState: unknown
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

    const contentType = c.req.header("content-type")
    if (contentType && contentType !== expectedContentType) {
      return badRequest(c, "Content-Type does not match the upload ticket")
    }

    if (!c.req.raw.body) {
      return badRequest(c, "Empty upload body")
    }

    let limitTripped = false

    if (await clipStorage.resolve(key)) {
      return conflict(c, "Upload ticket has already been used")
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
  })
  .post("/upload/:token/parts/:partNumber", async (c) => {
    const resolved = await resolveUploadTicket(c.req.param("token"), [
      "s3-multipart",
    ])
    if (resolved instanceof Response) return resolved
    const partNumber = parsePartNumber(c.req.param("partNumber"))
    if (!partNumber) return badRequest(c, "Invalid upload part number")
    const { payload } = resolved
    const partSizeBytes = payload.cs
    const uploadId = payload.mpu
    if (!partSizeBytes || !uploadId)
      return badRequest(c, "Invalid upload ticket")
    if (!partNumberInRange(partNumber, partSizeBytes, payload.mb)) {
      return badRequest(c, "Upload part is outside declared size")
    }

    const ticket = await clipStorage.mintUploadPartUrl({
      key: payload.k,
      uploadId,
      partNumber,
      expiresInSec: secondsUntil(payload.exp),
    })
    return c.json(ticket)
  })
  .post("/upload/:token/complete", async (c) => {
    const resolved = await resolveUploadTicket(c.req.param("token"), [
      "fs-chunked",
      "s3-multipart",
    ])
    if (resolved instanceof Response) return resolved
    const { payload, mode, ticket } = resolved
    const partSizeBytes = payload.cs
    if (!partSizeBytes) return badRequest(c, "Invalid upload ticket")

    const uploadState = parseUploadTicketStorageState(ticket.uploadState)
    if (mode === "s3-multipart" && uploadState?.uploadId !== payload.mpu) {
      return unauthorized(c, "Upload ticket storage state is invalid")
    }

    const parts =
      mode === "s3-multipart"
        ? await readMultipartCompleteParts(c.req.raw)
        : undefined
    if (parts instanceof Response) return parts
    if (parts && !validateCompleteParts(parts, partSizeBytes, payload.mb)) {
      return badRequest(c, "Multipart upload parts are invalid")
    }

    try {
      await clipStorage.completeUpload({
        key: payload.k,
        contentType: payload.ct,
        maxBytes: payload.mb,
        partSizeBytes,
        storageState: uploadState,
        parts,
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
      "s3-multipart",
    ])
    if (resolved instanceof Response) return resolved
    const { payload, ticket } = resolved
    await deleteStagedUpload(
      payload.k,
      parseUploadTicketStorageState(ticket.uploadState),
    )
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
    .select({ id: uploadTicket.id, uploadState: uploadTicket.upload_state })
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

function expectedPartCount(maxBytes: number, partSizeBytes: number): number {
  return Math.ceil(maxBytes / partSizeBytes)
}

function validateCompleteParts(
  parts: CompleteMultipartUploadPart[],
  partSizeBytes: number,
  maxBytes: number,
): boolean {
  if (parts.length !== expectedPartCount(maxBytes, partSizeBytes)) return false
  const seen = new Set<number>()
  for (const part of parts) {
    if (!Number.isSafeInteger(part.partNumber) || part.partNumber <= 0) {
      return false
    }
    if (!partNumberInRange(part.partNumber, partSizeBytes, maxBytes)) {
      return false
    }
    if (!part.etag.trim()) return false
    if (seen.has(part.partNumber)) return false
    seen.add(part.partNumber)
  }
  return true
}

async function readMultipartCompleteParts(
  request: Request,
): Promise<CompleteMultipartUploadPart[] | Response> {
  let data: unknown
  try {
    data = await request.json()
  } catch {
    return new Response("Invalid multipart completion body", { status: 400 })
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return new Response("Invalid multipart completion body", { status: 400 })
  }
  const parts = (data as { parts?: unknown }).parts
  if (!Array.isArray(parts)) {
    return new Response("Invalid multipart completion body", { status: 400 })
  }
  const parsed: CompleteMultipartUploadPart[] = []
  for (const item of parts) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return new Response("Invalid multipart completion body", { status: 400 })
    }
    const part = item as { partNumber?: unknown; etag?: unknown }
    if (
      typeof part.partNumber !== "number" ||
      !Number.isSafeInteger(part.partNumber) ||
      typeof part.etag !== "string" ||
      !part.etag.trim()
    ) {
      return new Response("Invalid multipart completion body", { status: 400 })
    }
    parsed.push({ partNumber: part.partNumber, etag: part.etag })
  }
  return parsed.sort((a, b) => a.partNumber - b.partNumber)
}

function secondsUntil(exp: number): number {
  return Math.max(1, exp - Math.floor(Date.now() / 1000))
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

async function deletePartialUpload(key: string): Promise<void> {
  try {
    await clipStorage.delete(key)
  } catch (err) {
    logger.warn(`failed to remove partial upload ${key}:`, err)
  }
}
