import { and, eq } from "drizzle-orm"

import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { env } from "../env"
import { join } from "../runtime/path"
import { abortEncode } from "./encode-abort"

type ClipRow = typeof clip.$inferSelect

export function resolveTrim(
  row: ClipRow,
  durationMs: number,
): { startMs: number | null; endMs: number | null } {
  const trimRequested = row.trimStartMs != null &&
    row.trimEndMs != null &&
    row.trimStartMs >= 0 &&
    row.trimEndMs > row.trimStartMs
  if (!trimRequested) return { startMs: null, endMs: null }
  return {
    startMs: row.trimStartMs as number,
    endMs: Math.min(row.trimEndMs as number, durationMs),
  }
}

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
  const base = env.ENCODE_SCRATCH_DIR ??
    join(Deno.env.get("TMPDIR") ?? "/tmp", "alloy-encode")
  await Deno.mkdir(base, { recursive: true })
  return Deno.makeTempDir({ dir: base, prefix: `${clipId}-` })
}
