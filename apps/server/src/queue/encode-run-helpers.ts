import { and, eq } from "drizzle-orm"

import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { ENCODE_DIR } from "../runtime/dirs"
import { abortEncode } from "./encode-abort"

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
  throw abortEncode()
}

export async function makeScratchDir(clipId: string): Promise<string> {
  await Deno.mkdir(ENCODE_DIR, { recursive: true })
  return Deno.makeTempDir({ dir: ENCODE_DIR, prefix: `${clipId}-` })
}
