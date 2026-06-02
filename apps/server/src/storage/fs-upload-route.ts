import { Hono } from "hono"
import { and, eq, gt, isNull } from "drizzle-orm"
import { clipUploadTicket } from "@workspace/db/schema"
import { logger } from "@workspace/logging"

import { decodeUploadToken } from "./fs-driver"
import { db } from "../db"
import { configStore } from "../config/store"
import {
  badRequest,
  conflict,
  internalServerError,
  noContent,
  payloadTooLarge,
  unauthorized,
} from "../runtime/http-response"
import { ensureScratchParent } from "../uploads/scratch"

type DenoFsFile = Awaited<ReturnType<typeof Deno.open>>

export const storageRoute = new Hono().post("/upload/:token", async (c) => {
  const token = c.req.param("token")
  const decoded = await decodeUploadToken(
    token,
    configStore.get("storage").fs.hmacSecret
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
        gt(clipUploadTicket.expiresAt, new Date())
      )
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
  await Deno.mkdir(tmpDir, { recursive: true })
  await Deno.mkdir(dirname(fullDst), { recursive: true })
  const tmpFile = `${tmpDir}/blob`

  let bytesWritten = 0
  let limitTripped = false
  const file = await Deno.open(tmpFile, {
    create: true,
    write: true,
    truncate: true,
  })

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
    file.close()
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
    await Deno.link(tmpFile, fullDst)
  } catch (err) {
    await removeTempUploadDir(tmpDir, "publish failure")
    if (err instanceof Deno.errors.AlreadyExists) {
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

function dirname(value: string): string {
  const index = value.lastIndexOf("/")
  return index <= 0 ? "/" : value.slice(0, index)
}

async function removeTempUploadDir(
  path: string,
  reason: string
): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true })
  } catch (err) {
    logger.warn(
      `[api/assets/upload] failed to remove temporary upload directory after ${reason}:`,
      err
    )
  }
}

async function writeAll(file: DenoFsFile, chunk: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < chunk.byteLength) {
    const written = await file.write(chunk.subarray(offset))
    if (written <= 0) {
      throw new Error("file write made no progress")
    }
    offset += written
  }
}
