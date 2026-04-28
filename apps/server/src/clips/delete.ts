import { eq } from "drizzle-orm"

import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { publishClipRemove } from "./events"
import { cancelEncode } from "../queue/encode-worker"
import { clipAssetKey, storage } from "../storage"

export async function deleteClipRowAndAssets(
  row: typeof clip.$inferSelect
): Promise<void> {
  await cancelEncode(row.id)
  await db.delete(clip).where(eq(clip.id, row.id))

  const keys = [
    row.storageKey,
    clipAssetKey(row.id, "video"),
    ...row.variants.map((variant) => variant.storageKey),
    row.thumbKey ?? clipAssetKey(row.id, "thumb"),
  ]
  for (const key of keys) {
    try {
      await storage.delete(key)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[clips] failed to delete ${key}:`, err)
    }
  }

  publishClipRemove(row.authorId, row.id)
}
