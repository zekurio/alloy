import { eq } from "drizzle-orm"
import type { Context } from "hono"
import { stream } from "hono/streaming"

import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { createZipStream } from "../archive/zip-stream"
import { deleteClipRowAndAssets } from "../clips/delete"
import { storage } from "../storage"
import {
  contentDisposition,
  downloadFilename,
  nodeToWeb,
} from "./clips-helpers"

export async function downloadOwnClips(c: Context, viewerId: string) {
  const rows = await db
    .select()
    .from(clip)
    .where(eq(clip.authorId, viewerId))
    .orderBy(clip.createdAt)

  const entries = rows.map((row) => ({
    filename: downloadFilename(row, "source"),
    stream: async () => {
      const resolved = await storage.resolve(row.storageKey)
      return resolved?.stream() ?? null
    },
  }))

  c.header("Content-Type", "application/zip")
  c.header(
    "Content-Disposition",
    contentDisposition(
      `alloy-clips-${new Date().toISOString().slice(0, 10)}.zip`
    )
  )
  c.header("Cache-Control", "no-store")

  const zip = createZipStream(entries)
  return stream(c, async (s) => {
    s.onAbort(() => {
      zip.destroy()
    })
    await s.pipe(nodeToWeb(zip))
  })
}

export async function deleteOwnClips(viewerId: string, limit: number) {
  const rows = await db
    .select()
    .from(clip)
    .where(eq(clip.authorId, viewerId))
    .orderBy(clip.createdAt)
    .limit(limit)

  for (const row of rows) {
    await deleteClipRowAndAssets(row)
  }

  return { deleted: rows.length, hasMore: rows.length === limit }
}
