import { clipUploadTicket } from "@alloy/db/schema"
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
import { and, eq, gt, isNull } from "drizzle-orm"
import { Hono } from "hono"

import { decodeUploadToken } from "./fs-driver"

const logger = createLogger("assets")

export const storageRoute = new Hono().post("/upload/:token", async (c) => {
  const token = c.req.param("token")
  const decoded = await decodeUploadToken(
    token,
    secretStore.get("uploadHmacSecret"),
  )
  if (!decoded.ok) {
    return unauthorized(c, "Invalid upload ticket")
  }
  const {
    k: key,
    ct: expectedContentType,
    mb: maxBytes,
    cid: clipId,
  } = decoded.payload

  const [ticket] = await db
    .select({ id: clipUploadTicket.id })
    .from(clipUploadTicket)
    .where(
      and(
        eq(clipUploadTicket.clipId, clipId),
        eq(clipUploadTicket.storageKey, key),
        eq(clipUploadTicket.contentType, expectedContentType),
        eq(clipUploadTicket.expectedBytes, maxBytes),
        isNull(clipUploadTicket.usedAt),
        gt(clipUploadTicket.expiresAt, new Date()),
      ),
    )
    .limit(1)
  if (!ticket) {
    return unauthorized(c, "Upload ticket has expired or already been used")
  }

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

  await db
    .update(clipUploadTicket)
    .set({ usedAt: new Date() })
    .where(eq(clipUploadTicket.id, ticket.id))

  return noContent(c)
})

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
