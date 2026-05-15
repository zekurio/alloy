import { and, eq } from "drizzle-orm"

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
import { join } from "../runtime/path"
import { clipOpenGraphVideoKey, clipSourceMp4Key, storage } from "../storage"
import {
  isOpenGraphVariant,
  OPEN_GRAPH_VARIANT_ID,
  openGraphCompatibleSource,
} from "../open-graph/video-selection"
import { codecNameFor, encode, probe, remuxToMp4 } from "./ffmpeg"
import { abortEncode } from "./encode-abort"
import { pruneStaleVariants, settingsEqual } from "./encode-variant-helpers"
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
  const remuxPath = join(scratchDir, "source.mp4")
  const remuxKey = clipSourceMp4Key(clipId, runId)
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
    const publishState = await db.transaction(async (tx) => {
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
    if (!publishState.published) {
      await storage.delete(remuxKey).catch(() => undefined)
      throw abortEncode()
    }
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
  if (!publishState.published) {
    await deleteRunScopedVariants([sourceVariant, ...retainedVariants], runId)
    throw abortEncode()
  }
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
  if (!publishState.published) {
    await deleteRunScopedVariants(
      sourceVariant
        ? [...variants, sourceVariant, ...retainedVariants]
        : [...variants, ...retainedVariants],
      runId
    )
    throw abortEncode()
  }
  void publishClipUpsert(authorId, clipId)
  notifyFollowersIfNewPublicClip(authorId, clipId, publishState)
}

export async function publishOpenGraphVariant({
  clipId,
  row,
  source,
  sourcePath,
  scratchDir,
  probed,
  trim,
  config,
  signal,
  runId,
}: {
  clipId: string
  row: ClipRow
  source: { storageKey: string; contentType: string; sizeBytes: number }
  sourcePath: string
  scratchDir: string
  probed: Awaited<ReturnType<typeof probe>>
  trim: { startMs: number | null; endMs: number | null }
  config: EncoderConfig
  signal: AbortSignal
  runId: string
}): Promise<ClipEncodedVariant> {
  const reusableSource = openGraphCompatibleSource({
    contentType: source.contentType,
    videoCodec: probed.videoCodec,
    audioCodec: probed.audioCodec,
    height: probed.height,
    trim,
  })
  if (reusableSource) {
    return {
      id: OPEN_GRAPH_VARIANT_ID,
      label: "OpenGraph",
      role: "openGraph",
      storageKey: source.storageKey,
      contentType: source.contentType,
      width: probed.width,
      height: probed.height,
      sizeBytes: source.sizeBytes,
      isDefault: false,
      settings: {
        hwaccel: "source",
        codec: "h264",
        audioCodec: probed.audioCodec === "aac" ? "aac" : "none",
        quality: 0,
        audioBitrateKbps: 0,
        extraInputArgs: "",
        extraOutputArgs: "",
        height: probed.height,
        trimStartMs: null,
        trimEndMs: null,
      },
    }
  }

  const targetHeight = Math.min(probed.height, 1080)
  const storageKey = clipOpenGraphVideoKey(clipId, runId)
  const settings: ClipVariantSettings = {
    hwaccel: config.hwaccel,
    codec: "h264",
    audioCodec: "aac",
    quality: 23,
    audioBitrateKbps: 256,
    extraInputArgs: "",
    extraOutputArgs: "",
    height: targetHeight,
    trimStartMs: trim.startMs,
    trimEndMs: trim.endMs,
  }
  const existing = row.variants.find(isOpenGraphVariant)
  if (existing?.settings && settingsEqual(existing.settings, settings)) {
    const fileHit = await storage.resolve(existing.storageKey)
    if (fileHit) return existing
  }

  const variantPath = join(scratchDir, `${OPEN_GRAPH_VARIANT_ID}.mp4`)
  await encode(sourcePath, variantPath, {
    config: {
      hwaccel: config.hwaccel,
      encoder: codecNameFor(config.hwaccel, "h264"),
      quality: settings.quality,
      audioBitrateKbps: settings.audioBitrateKbps,
      extraInputArgs: "",
      extraOutputArgs: "",
      qsvDevice: config.qsvDevice,
      vaapiDevice: config.vaapiDevice,
    },
    targetHeight,
    durationMs:
      trim.startMs != null && trim.endMs != null
        ? Math.max(1, trim.endMs - trim.startMs)
        : probed.durationMs,
    onProgress: () => undefined,
    trimStartMs: trim.startMs,
    trimEndMs: trim.endMs,
    signal,
  })

  await ensureClipStillPresent(clipId, runId, signal)
  const variantProbe = await probe(variantPath)
  await ensureClipStillPresent(clipId, runId, signal)
  const { size } = await storage.uploadFromFile(
    variantPath,
    storageKey,
    "video/mp4"
  )
  await Deno.remove(variantPath).catch(() => undefined)

  return {
    id: OPEN_GRAPH_VARIANT_ID,
    label: "OpenGraph",
    role: "openGraph",
    storageKey,
    contentType: "video/mp4",
    width: variantProbe.width,
    height: variantProbe.height,
    sizeBytes: size,
    isDefault: false,
    settings,
  }
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
  runId: string
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
    dims: { width: number; height: number; sizeBytes: number },
    storageKey = spec.storageKey
  ): ClipEncodedVariant => {
    const encodedVariant = {
      id: spec.id,
      label: spec.label,
      role: "variant" as const,
      storageKey,
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
    await ensureClipStillPresent(opts.clipId, opts.runId, opts.signal)
    const reuse = opts.reuse.get(index)
    if (reuse) {
      pushVariant(variant, index, reuse, reuse.storageKey)
      completedWork += 1
      const progress = Math.floor((completedWork / totalWork) * 100)
      opts.writeProgress(progress)
      await opts.onVariant(encodedVariants, progress)
      continue
    }

    const variantPath = join(opts.paths.scratchDir, `${variant.id}.mp4`)
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

    await ensureClipStillPresent(opts.clipId, opts.runId, opts.signal)
    const variantProbe = await probe(variantPath)
    await ensureClipStillPresent(opts.clipId, opts.runId, opts.signal)
    const { size: uploadedSize } = await storage.uploadFromFile(
      variantPath,
      variant.storageKey,
      "video/mp4"
    )
    await Deno.remove(variantPath).catch(() => undefined)

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
  throw abortEncode()
}

async function deleteRunScopedVariants(
  variants: readonly ClipEncodedVariant[],
  runId: string
): Promise<void> {
  const keys = new Set(
    variants
      .map((variant) => variant.storageKey)
      .filter((storageKey) => storageKey.includes(runId))
  )
  await Promise.allSettled([...keys].map((key) => storage.delete(key)))
}

export async function makeScratchDir(clipId: string): Promise<string> {
  const base =
    env.ENCODE_SCRATCH_DIR ??
    join(Deno.env.get("TMPDIR") ?? "/tmp", "alloy-encode")
  await Deno.mkdir(base, { recursive: true })
  return Deno.makeTempDir({ dir: base, prefix: `${clipId}-` })
}
