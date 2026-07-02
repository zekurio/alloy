import { clipRendition, type ClipRendition } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { desc, eq } from "drizzle-orm"

/** Committed renditions for a clip, highest tier first. */
export async function selectClipRenditions(
  clipId: string,
): Promise<ClipRendition[]> {
  return db
    .select()
    .from(clipRendition)
    .where(eq(clipRendition.clip_id, clipId))
    .orderBy(desc(clipRendition.height))
}
