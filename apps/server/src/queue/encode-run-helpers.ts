import { promises as fsp } from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"

import {
  clip,
  type ClipEncodedVariant,
  type ClipVariantSettings,
} from "@workspace/db/schema"

import { db } from "../db"
import { env } from "../env"
import { publishClipUpsert } from "../clips/events"
import { notifyFollowersOfNewClip } from "../notifications"
import { type EncoderConfig } from "../config/store"
import { clipSourceMp4Key, storage } from "../storage"
import { codecNameFor, encode, probe, remuxToMp4 } from "./ffmpeg"
import { pruneStaleVariants } from "./encode-variant-helpers"
import type { VariantSpec } from "./variant-specs"
import {
  makeSourceVariant,
  mergeVariantSets,
  removeSourceVariants,
} from "./encode-source-helpers"

type ClipRow = typeof clip.$inferSelect

export async function tryPublishRemux({
  clipId,
  row,
  sourcePath,
  scratchDir,
  trim,
  signal,
  originalSourceKey,
  exposeSource,
}: {
  clipId: string
  row: ClipRow
  sourcePath: string
  scratchDir: string
  trim: { startMs: number | null; endMs: number | null }
  signal: AbortSignal
  originalSourceKey: string
  exposeSource: boolean
}): Promise<{ path: string; variant: ClipEncodedVariant } | null> {
  const remuxPath = path.join(scratchDir, "source.mp4")
  const remuxKey = clipSourceMp4Key(clipId)
  try {
    await remuxToMp4(sourcePath, remuxPath, {
      trimStartMs: trim.startMs,
      trimEndMs: trim.endMs,
      signal,
    })
    await ensureClipStillPresent(clipId, signal)
    const remuxProbe = await probe(remuxPath)
    await ensureClipStillPresent(clipId, signal)
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
    const previous = await db.transaction(async (tx) => {
      const previous = await readClipPublishState(tx, clipId)
      await tx
        .update(clip)
        .set({
          status: "ready",
          encodeProgress: 0,
          failureReason: null,
          storageKey: remuxKey,
          contentType: "video/mp4",
          sizeBytes: size,
          width: remuxProbe.width,
          height: remuxProbe.height,
          variants: exposeSource
            ? mergeVariantSets(row.variants, [variant])
            : removeSourceVariants(row.variants),
          updatedAt: new Date(),
        })
        .where(eq(clip.id, clipId))
      return previous
    })
    if (originalSourceKey !== remuxKey) {
      await storage.delete(originalSourceKey).catch(() => undefined)
    }
    void publishClipUpsert(row.authorId, clipId)
    notifyFollowersIfNewPublicClip(row.authorId, clipId, previous)
    return { path: remuxPath, variant }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err
    const reason = err instanceof Error ? err.message : "Remux failed"
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
}: {
  clipId: string
  authorId: string
  row: ClipRow
  sourceVariant: ClipEncodedVariant
}): Promise<void> {
  await pruneStaleVariants(row, new Map(), sourceVariant)
  const previous = await db.transaction(async (tx) => {
    const previous = await readClipPublishState(tx, clipId)
    await tx
      .update(clip)
      .set({
        status: "ready",
        encodeProgress: 100,
        failureReason: null,
        sizeBytes: sourceVariant.sizeBytes,
        width: sourceVariant.width,
        height: sourceVariant.height,
        variants: [sourceVariant],
        updatedAt: new Date(),
      })
      .where(eq(clip.id, clipId))
    return previous
  })
  void publishClipUpsert(authorId, clipId)
  notifyFollowersIfNewPublicClip(authorId, clipId, previous)
}

export async function publishEncodedVariants({
  clipId,
  authorId,
  variants,
  sourceVariant,
  progress,
}: {
  clipId: string
  authorId: string
  variants: readonly ClipEncodedVariant[]
  sourceVariant: ClipEncodedVariant | null
  progress: number
}): Promise<void> {
  const defaultVariant =
    variants.find((variant) => variant.isDefault) ?? variants[0]
  if (!defaultVariant) return

  const previous = await db.transaction(async (tx) => {
    const previous = await readClipPublishState(tx, clipId)
    await tx
      .update(clip)
      .set({
        status: "ready",
        encodeProgress: progress,
        failureReason: null,
        sizeBytes: sourceVariant?.sizeBytes ?? defaultVariant.sizeBytes,
        width: sourceVariant?.width ?? defaultVariant.width,
        height: sourceVariant?.height ?? defaultVariant.height,
        variants: sourceVariant
          ? mergeVariantSets([...variants], [sourceVariant])
          : [...variants],
        updatedAt: new Date(),
      })
      .where(eq(clip.id, clipId))
    return previous
  })
  void publishClipUpsert(authorId, clipId)
  notifyFollowersIfNewPublicClip(authorId, clipId, previous)
}

function notifyFollowersIfNewPublicClip(
  authorId: string,
  clipId: string,
  previous: ClipPublishState | undefined
): void {
  if (
    previous &&
    previous.status !== "ready" &&
    previous.privacy === "public"
  ) {
    void notifyFollowersOfNewClip({ authorId, clipId })
  }
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

type EncodeVariantsOpts = {
  clipId: string
  specs: VariantSpec[]
  settings: ClipVariantSettings[]
  reuse: Map<number, ClipEncodedVariant>
  paths: { sourcePath: string; scratchDir: string }
  config: EncoderConfig
  duration: number
  trim: { startMs: number | null; endMs: number | null }
  signal: AbortSignal
  writeProgress: (pct: number) => void
  onVariant: (
    variants: readonly ClipEncodedVariant[],
    progress: number
  ) => Promise<void>
}

export async function encodeVariants(
  opts: EncodeVariantsOpts
): Promise<ClipEncodedVariant[]> {
  const encodedVariants: ClipEncodedVariant[] = []
  let completedWork = 0
  const totalWork = opts.specs.length

  const pushVariant = (
    spec: VariantSpec,
    index: number,
    dims: { width: number; height: number; sizeBytes: number }
  ): ClipEncodedVariant => {
    const encodedVariant = {
      id: spec.id,
      label: spec.label,
      role: "variant" as const,
      storageKey: spec.storageKey,
      contentType: "video/mp4",
      width: dims.width,
      height: dims.height,
      sizeBytes: dims.sizeBytes,
      isDefault: spec.isDefault,
      settings: opts.settings[index],
    }
    encodedVariants.push(encodedVariant)
    return encodedVariant
  }

  for (const [index, variant] of opts.specs.entries()) {
    await ensureClipStillPresent(opts.clipId, opts.signal)
    const reuse = opts.reuse.get(index)
    if (reuse) {
      pushVariant(variant, index, reuse)
      completedWork += 1
      const progress = Math.floor((completedWork / totalWork) * 100)
      opts.writeProgress(progress)
      await opts.onVariant(encodedVariants, progress)
      continue
    }

    const variantPath = path.join(opts.paths.scratchDir, `${variant.id}.mp4`)
    const rungConfig = {
      hwaccel: opts.config.hwaccel,
      encoder: codecNameFor(opts.config.hwaccel, variant.override.codec),
      quality: variant.override.quality,
      preset: variant.override.preset,
      audioBitrateKbps: variant.override.audioBitrateKbps,
      extraInputArgs: variant.override.extraInputArgs,
      extraOutputArgs: variant.override.extraOutputArgs,
      qsvDevice: opts.config.qsvDevice,
      vaapiDevice: opts.config.vaapiDevice,
    }

    await encode(opts.paths.sourcePath, variantPath, {
      config: rungConfig,
      targetHeight: variant.height,
      durationMs: opts.duration,
      onProgress: (pct) => {
        const overallPct = Math.floor(
          ((completedWork + pct / 100) / totalWork) * 100
        )
        opts.writeProgress(overallPct)
      },
      trimStartMs: opts.trim.startMs,
      trimEndMs: opts.trim.endMs,
      signal: opts.signal,
    })

    await ensureClipStillPresent(opts.clipId, opts.signal)
    const variantProbe = await probe(variantPath)
    await ensureClipStillPresent(opts.clipId, opts.signal)
    const { size: uploadedSize } = await storage.uploadFromFile(
      variantPath,
      variant.storageKey,
      "video/mp4"
    )
    await fsp.rm(variantPath, { force: true }).catch(() => undefined)

    pushVariant(variant, index, {
      width: variantProbe.width,
      height: variantProbe.height,
      sizeBytes: uploadedSize,
    })
    completedWork += 1
    const progress = Math.floor((completedWork / totalWork) * 100)
    opts.writeProgress(progress)
    await opts.onVariant(encodedVariants, progress)
  }

  return encodedVariants
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
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted()
  const [row] = await db
    .select({ id: clip.id })
    .from(clip)
    .where(eq(clip.id, clipId))
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
