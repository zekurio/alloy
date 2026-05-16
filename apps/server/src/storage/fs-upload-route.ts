import { Hono } from "hono"
import { and, eq, gt, isNull } from "drizzle-orm"
import { clipUploadTicket } from "@workspace/db/schema"

import { decodeUploadToken } from "./fs-driver"
import { db } from "../db"
import { configStore } from "../config/store"
import { ensureScratchParent } from "../uploads/scratch"

export const storageRoute = new Hono().post("/upload/:token", async (c) => {
  const token = c.req.param("token")
  const decoded = await decodeUploadToken(
    token,
    configStore.get("storage").fs.hmacSecret
  )
  if (!decoded.ok) {
    return c.json({ error: "Invalid upload ticket" }, 401)
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
    return c.json(
      { error: "Upload ticket has expired or already been used" },
      401
    )
  }

  const contentType = c.req.header("content-type")
  if (contentType && contentType !== expectedContentType) {
    return c.json(
      { error: "Content-Type does not match the upload ticket" },
      400
    )
  }

  if (!c.req.raw.body) {
    return c.json({ error: "Empty upload body" }, 400)
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
    await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined)
    if (limitTripped) {
      return c.json({ error: "Upload exceeded maximum size" }, 413)
    }
    // eslint-disable-next-line no-console
    console.error("[api/assets/upload] write failed:", err)
    return c.json({ error: "Upload write failed" }, 500)
  } finally {
    file.close()
  }

  try {
    await Deno.link(tmpFile, fullDst)
  } catch (err) {
    await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined)
    if (err instanceof Deno.errors.AlreadyExists) {
      return c.json({ error: "Upload ticket has already been used" }, 409)
    }
    // eslint-disable-next-line no-console
    console.error("[api/assets/upload] publish failed:", err)
    return c.json({ error: "Upload publish failed" }, 500)
  }
  await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined)
  await db
    .update(clipUploadTicket)
    .set({ usedAt: new Date() })
    .where(eq(clipUploadTicket.id, ticket.id))

  return c.body(null, 204)
})

function dirname(value: string): string {
  const index = value.lastIndexOf("/")
  return index <= 0 ? "/" : value.slice(0, index)
}

async function writeAll(file: Deno.FsFile, chunk: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < chunk.byteLength) {
    const written = await file.write(chunk.subarray(offset))
    if (written <= 0) {
      throw new Error("file write made no progress")
    }
    offset += written
  }
}
