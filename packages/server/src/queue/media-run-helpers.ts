import { mkdir, mkdtemp } from "node:fs/promises"

import { clip } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { MEDIA_CACHE_DIR } from "@alloy/server/runtime/dirs"
import { and, eq } from "drizzle-orm"

import { abortMediaProcessing } from "./media-abort"

export async function ensureClipStillPresent(
  clipId: string,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  const [row] = await db
    .select({ id: clip.id })
    .from(clip)
    .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
    .limit(1)
  if (row) return
  throw abortMediaProcessing()
}

export async function makeMediaWorkDir(clipId: string): Promise<string> {
  await mkdir(MEDIA_CACHE_DIR, { recursive: true })
  return mkdtemp(`${MEDIA_CACHE_DIR}/${clipId}-`)
}
