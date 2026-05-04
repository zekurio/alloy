import { and, eq } from "drizzle-orm"
import type { Context } from "hono"

import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { publishClipUpsert } from "../clips/events"
import { selectClipById } from "../clips/select"
import { enqueueEncode } from "../queue"
import { clipAssetKey, storage } from "../storage"
import { validateImageBytes } from "../media/image-validation"
import {
  assertUsableUploadTicket,
  markUploadFailed,
  markUploadTicketUsed,
  selectLockedQuotaState,
  type InitiateQuotaResult,
} from "./clips-upload-helpers"

export async function finalizeClipUpload(
  c: Context,
  viewerId: string,
  id: string
) {
  const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
  if (!row) return c.json({ error: "Not found" }, 404)
  if (row.authorId !== viewerId) {
    return c.json({ error: "Forbidden" }, 403)
  }
  if (row.status !== "pending") {
    return c.json({ error: `Clip is already ${row.status}` }, 409)
  }
  const videoTicketOk = await assertUsableUploadTicket({
    clipId: id,
    storageKey: row.storageKey,
    contentType: row.contentType,
    expectedBytes: row.sizeBytes ?? 0,
    role: "video",
  })
  if (!videoTicketOk) {
    await markUploadFailed(row.authorId, id, "Upload ticket expired")
    return c.json({ error: "Upload ticket expired" }, 410)
  }

  const resolved = await storage.resolve(row.storageKey)
  if (!resolved) {
    await markUploadFailed(row.authorId, id, "Upload bytes are missing")
    return c.json({ error: "Upload bytes are missing" }, 400)
  }

  const declaredSize = row.sizeBytes ?? 0
  if (declaredSize > 0 && resolved.size !== declaredSize) {
    await cleanupUploadBytes(row.storageKey, row.thumbKey)
    await markUploadFailed(
      row.authorId,
      id,
      "Upload size did not match declared size"
    )
    return c.json({ error: "Upload size did not match declared size" }, 400)
  }

  if (resolved.contentType !== row.contentType) {
    await cleanupUploadBytes(row.storageKey, row.thumbKey)
    await markUploadFailed(
      row.authorId,
      id,
      "Upload content type did not match declared type"
    )
    return c.json(
      { error: "Upload content type did not match declared type" },
      400
    )
  }

  if (row.thumbKey) {
    const thumbError = await validateUploadedThumbnail(id, row.thumbKey)
    if (thumbError) {
      await markUploadFailed(row.authorId, id, thumbError.message)
      return c.json({ error: thumbError.message }, thumbError.status)
    }
  }
  const canonicalThumbKey = clipAssetKey(id, "thumb")

  const quotaResult = await db.transaction<InitiateQuotaResult>(async (tx) => {
    const { quotaBytes, usedBytes } = await selectLockedQuotaState(tx, viewerId)
    const previousSize = row.sizeBytes ?? 0
    if (
      quotaBytes !== null &&
      usedBytes - previousSize + resolved.size > quotaBytes
    ) {
      return { ok: false, usedBytes, quotaBytes }
    }
    return { ok: true }
  })
  if (!quotaResult.ok) {
    await cleanupUploadBytes(row.storageKey, row.thumbKey)
    await markUploadFailed(row.authorId, id, "Storage quota exceeded")
    return c.json(
      {
        error: "Storage quota exceeded",
        usedBytes: quotaResult.usedBytes,
        quotaBytes: quotaResult.quotaBytes,
      },
      413
    )
  }

  if (row.thumbKey && row.thumbKey !== canonicalThumbKey) {
    try {
      await storage.copy({
        fromKey: row.thumbKey,
        toKey: canonicalThumbKey,
        contentType: "image/jpeg",
      })
    } catch (err) {
      const [current] = await db
        .select({ status: clip.status })
        .from(clip)
        .where(eq(clip.id, id))
        .limit(1)
      if (current?.status !== "pending") {
        return c.json({ error: "Clip is already being finalized" }, 409)
      }
      throw err
    }
  }

  const [transitioned] = await db
    .update(clip)
    .set({
      status: "uploaded",
      sizeBytes: resolved.size,
      thumbKey: canonicalThumbKey,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clip.id, id),
        eq(clip.authorId, viewerId),
        eq(clip.status, "pending")
      )
    )
    .returning({ id: clip.id })
  if (!transitioned) {
    return c.json({ error: "Clip is already being finalized" }, 409)
  }
  if (row.thumbKey && row.thumbKey !== canonicalThumbKey) {
    await storage.delete(row.thumbKey).catch(() => undefined)
  }

  void publishClipUpsert(viewerId, id)

  enqueueEncode(id)
  await Promise.all([
    markUploadTicketUsed(row.storageKey),
    row.thumbKey ? markUploadTicketUsed(row.thumbKey) : Promise.resolve(),
  ]).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn(`[clips/finalize] could not mark upload tickets used:`, err)
  })

  const updated = await selectClipById(id)
  return c.json(updated)
}

async function cleanupUploadBytes(storageKey: string, thumbKey: string | null) {
  await storage.delete(storageKey).catch(() => undefined)
  if (thumbKey) {
    await storage.delete(thumbKey).catch(() => undefined)
  }
}

async function validateUploadedThumbnail(
  clipId: string,
  thumbKey: string
): Promise<{ message: string; status: 400 | 410 } | null> {
  const thumbResolved = await storage.resolve(thumbKey)
  if (!thumbResolved) {
    return { message: "Thumbnail bytes are missing", status: 400 }
  }
  const thumbTicketOk = await assertUsableUploadTicket({
    clipId,
    storageKey: thumbKey,
    contentType: "image/jpeg",
    expectedBytes: thumbResolved.size,
    role: "thumbnail",
  })
  if (!thumbTicketOk) {
    return { message: "Thumbnail ticket expired", status: 410 }
  }
  const thumbBytes = await readResolvedObject(thumbResolved)
  const thumbValidation = validateImageBytes(thumbBytes, "image/jpeg")
  if (!thumbValidation.ok) {
    await storage.delete(thumbKey).catch(() => undefined)
    return { message: thumbValidation.error, status: 400 }
  }
  return null
}

async function readResolvedObject(resolved: {
  stream: () => NodeJS.ReadableStream
}): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of resolved.stream()) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
