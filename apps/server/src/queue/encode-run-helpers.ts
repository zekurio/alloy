import { promises as fsp } from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"

import { clip, type ClipEncodedVariant } from "@workspace/db/schema"

import { db } from "../db"
import { env } from "../env"
import { publishClipUpsert } from "../clips/events"
import { notifyFollowersOfNewClip } from "../notifications"
import { clipSourceMp4Key, storage } from "../storage"
import { probe, remuxToMp4 } from "./ffmpeg"
import { pruneStaleVariants } from "./encode-variant-helpers"
import {
  makeSourceVariant,
  mergeVariantSets,
  removeSourceVariants,
} from "./encode-source-helpers"
export { encodeVariants, publishOpenGraphVariant } from "./encode-variants"

type ClipRow = typeof clip.$inferSelect

export async function tryPublishRemux({
  clipId,
  row,
  sourcePath,
  scratchDir,
  trim,
  signal,
  exposeSource,
  runId,
}: {
  clipId: string
  row: ClipRow
  sourcePath: string
  scratchDir: string
  trim: { startMs: number | null; endMs: number | null }
  signal: AbortSignal
  exposeSource: boolean
  runId: string
}): Promise<{ path: string; variant: ClipEncodedVariant } | null> {
  const remuxPath = path.join(scratchDir, "source.mp4")
  const remuxKey = clipSourceMp4Key(clipId)
  const hasTrim = trim.startMs != null && trim.endMs != null
  try {
    await remuxToMp4(sourcePath, remuxPath, {
      trimStartMs: trim.startMs,
      trimEndMs: trim.endMs,
      signal,
    })
    await ensureClipStillPresent(clipId, runId, signal)
    const remuxProbe = await probe(remuxPath)
    await ensureClipStillPresent(clipId, runId, signal)
    const { size } = await storage.uploadFromFile(
      remuxPath,
      remuxKey,
      "video/mp4"
    )
    const variant = makeSourceVariant({
      storageKey: remuxKey,
      contentType: "video/mp4",
      width: remuxProbe.width,
      height: remuxProbe.height,
      sizeBytes: size,
      isDefault: true,
      trim,
    })
    await db.transaction(async (tx) => {
      const previous = await readClipPublishState(tx, clipId)
      const [published] = await tx
        .update(clip)
        .set({
          status: "encoding",
          encodeProgress: 0,
          failureReason: null,
          ...(hasTrim
            ? {
                storageKey: remuxKey,
                contentType: "video/mp4",
                sizeBytes: size,
                width: remuxProbe.width,
                height: remuxProbe.height,
              }
            : {}),
          variants: exposeSource
            ? mergeVariantSets(row.variants, [variant])
            : removeSourceVariants(row.variants),
          updatedAt: new Date(),
        })
        .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
        .returning({ status: clip.status, privacy: clip.privacy })
      return { previous, published }
    })
    void publishClipUpsert(row.authorId, clipId)
    return { path: remuxPath, variant }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err
    const reason = err instanceof Error ? err.message : "Remux failed"
    console.warn(`[ffmpeg] clip ${clipId}: remux failed: ${reason}`)
    await db
      .update(clip)
      .set({
        failureReason: reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(clip.id, clipId))
    void publishClipUpsert(row.authorId, clipId)
    return null
  }
}

export async function publishSourceOnlyClip({
  clipId,
  authorId,
  row,
  sourceVariant,
  retainedVariants = [],
  runId,
}: {
  clipId: string
  authorId: string
  row: ClipRow
  sourceVariant: ClipEncodedVariant
  retainedVariants?: readonly ClipEncodedVariant[]
  runId: string
}): Promise<void> {
  await pruneStaleVariants(row, new Map(), sourceVariant, retainedVariants)
  const publishState = await db.transaction(async (tx) => {
    const previous = await readClipPublishState(tx, clipId)
    const [published] = await tx
      .update(clip)
      .set({
        status: "ready",
        encodeProgress: 100,
        failureReason: null,
        variants: mergeVariantSets([sourceVariant], retainedVariants),
        encodeRunId: null,
        encodeLockedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
      .returning({ status: clip.status, privacy: clip.privacy })
    return { previous, published }
  })
  void publishClipUpsert(authorId, clipId)
  notifyFollowersIfNewPublicClip(authorId, clipId, publishState)
}

export async function publishEncodedVariants({
  clipId,
  authorId,
  variants,
  sourceVariant,
  retainedVariants = [],
  progress,
  runId,
}: {
  clipId: string
  authorId: string
  variants: readonly ClipEncodedVariant[]
  sourceVariant: ClipEncodedVariant | null
  retainedVariants?: readonly ClipEncodedVariant[]
  progress: number
  runId: string
}): Promise<void> {
  if (variants.length === 0) return

  const publishState = await db.transaction(async (tx) => {
    const previous = await readClipPublishState(tx, clipId)
    const [published] = await tx
      .update(clip)
      .set({
        status: progress >= 100 ? "ready" : "encoding",
        encodeProgress: progress,
        failureReason: null,
        variants: mergeVariantSets(
          sourceVariant
            ? mergeVariantSets([...variants], [sourceVariant])
            : variants,
          retainedVariants
        ),
        updatedAt: new Date(),
      })
      .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
      .returning({ status: clip.status, privacy: clip.privacy })
    return { previous, published }
  })
  void publishClipUpsert(authorId, clipId)
  notifyFollowersIfNewPublicClip(authorId, clipId, publishState)
}

function notifyFollowersIfNewPublicClip(
  authorId: string,
  clipId: string,
  state: ClipPublishStateChange
): void {
  const { previous, published } = state
  if (
    previous &&
    previous.status !== "ready" &&
    published?.status === "ready" &&
    published.privacy === "public"
  ) {
    void notifyFollowersOfNewClip({ authorId, clipId })
  }
}

type ClipPublishStateChange = {
  previous: ClipPublishState | undefined
  published: ClipPublishState | undefined
}

type ClipPublishState = {
  status: ClipRow["status"]
  privacy: ClipRow["privacy"]
}

type ClipPublishStateReader = Pick<typeof db, "select">

async function readClipPublishState(
  tx: ClipPublishStateReader,
  clipId: string
): Promise<ClipPublishState | undefined> {
  const [current] = await tx
    .select({ status: clip.status, privacy: clip.privacy })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
    .for("update")
  return current
}

export function resolveTrim(
  row: ClipRow,
  durationMs: number
): { startMs: number | null; endMs: number | null } {
  const trimRequested =
    row.trimStartMs != null &&
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
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted()
  const [row] = await db
    .select({ id: clip.id })
    .from(clip)
    .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
    .limit(1)
  if (row) return
  const err = new Error("Encode cancelled")
  err.name = "AbortError"
  throw err
}

export async function makeScratchDir(clipId: string): Promise<string> {
  const base = env.ENCODE_SCRATCH_DIR ?? path.join(os.tmpdir(), "alloy-encode")
  await fsp.mkdir(base, { recursive: true })
  return fsp.mkdtemp(path.join(base, `${clipId}-`))
}
