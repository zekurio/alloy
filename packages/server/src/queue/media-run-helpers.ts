import { mkdir, mkdtemp } from "node:fs/promises"

import { clip } from "alloy-db/schema"
import { and, eq } from "drizzle-orm"

import { db } from "../db"
import { ENCODE_DIR } from "../runtime/dirs"
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

export async function makeScratchDir(clipId: string): Promise<string> {
  await mkdir(ENCODE_DIR, { recursive: true })
  return mkdtemp(`${ENCODE_DIR}/${clipId}-`)
}
