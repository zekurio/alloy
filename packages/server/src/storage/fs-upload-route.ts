import { link, mkdir, open, rm } from "node:fs/promises"

import { clipUploadTicket } from "@alloy/db/schema"
import { logger } from "@alloy/logging"
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
import { dirname } from "@alloy/server/runtime/path"
import { ensureScratchParent } from "@alloy/server/uploads/scratch"
import { and, eq, gt, isNull } from "drizzle-orm"
import { Hono } from "hono"

import { decodeUploadToken } from "./fs-driver"

type FsFile = Awaited<ReturnType<typeof open>>

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

  const fullDst = await ensureScratchParent(key)
  const tmpDir = `${dirname(fullDst)}/.tmp-${token.slice(-32)}`
  await mkdir(tmpDir, { recursive: true })
  await mkdir(dirname(fullDst), { recursive: true })
  const tmpFile = `${tmpDir}/blob`

  let bytesWritten = 0
  let limitTripped = false
  const file = await open(tmpFile, "w")

  let writeFailure: unknown = null
  try {
    for await (const chunk of c.req.raw.body) {
      bytesWritten += chunk.byteLength
      if (bytesWritten > maxBytes) {
        limitTripped = true
        throw new Error("upload exceeded maxBytes")
      }
      await writeAll(file, chunk)
    }
  } catch (err) {
    writeFailure = err
  } finally {
    await file.close()
  }

  if (writeFailure) {
    await removeTempUploadDir(tmpDir, "write failure")
    if (limitTripped) {
      return payloadTooLarge(c, "Upload exceeded maximum size")
    }
    logger.error("[api/assets/upload] write failed:", writeFailure)
    return internalServerError(c, "Upload write failed")
  }

  try {
    await link(tmpFile, fullDst)
  } catch (err) {
    await removeTempUploadDir(tmpDir, "publish failure")
    if (isNodeErrorCode(err, "EEXIST")) {
      return conflict(c, "Upload ticket has already been used")
    }
    logger.error("[api/assets/upload] publish failed:", err)
    return internalServerError(c, "Upload publish failed")
  }
  await removeTempUploadDir(tmpDir, "publish success")
  await db
    .update(clipUploadTicket)
    .set({ usedAt: new Date() })
    .where(eq(clipUploadTicket.id, ticket.id))

  return noContent(c)
})

async function removeTempUploadDir(
  path: string,
  reason: string,
): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true })
  } catch (err) {
    logger.warn(
      `[api/assets/upload] failed to remove temporary upload directory after ${reason}:`,
      err,
    )
  }
}

async function writeAll(file: FsFile, chunk: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await file.write(chunk.subarray(offset))
    if (bytesWritten <= 0) {
      throw new Error("file write made no progress")
    }
    offset += bytesWritten
  }
}

function isNodeErrorCode(err: unknown, code: string): boolean {
  return (err as { code?: string } | null)?.code === code
}
