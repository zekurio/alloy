import { clip, clipRendition, instanceSetting } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import {
  encodeFingerprint,
  expectedLadder,
} from "@alloy/server/media/encode-fingerprint"
import { MEDIA_PIPELINE_VERSION } from "@alloy/server/media/pipeline-version"
import type { LadderStep } from "@alloy/server/media/renditions"
import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm"
import { z } from "zod"

import { defineJobKind, type JobHandlerContext } from "../registry"
import { enqueue, type EnqueueOptions } from "../store"
import { enqueueClipEncode } from "./clip-encode"

const logger = createLogger("jobs")

const CLIP_RENDITIONS_SWEEP_KIND = "clip.renditions-sweep"
const PAGE_SIZE = 500
const SWEEP_SUMMARY_KEY = "renditionSweep"

const RenditionsSweepPayloadSchema = z
  .object({
    mode: z.enum(["stale", "force"]).default("stale"),
  })
  .default({ mode: "stale" })

type RenditionsSweepPayload = z.infer<typeof RenditionsSweepPayloadSchema>

interface SweepClipRow {
  id: string
  height: number | null
  sourceFps: number | null
  sourceContentType: string | null
  sourceCodecs: string | null
  trimStartMs: number | null
  trimEndMs: number | null
  encodeFingerprint: string | null
  encodeFailedFingerprint: string | null
  encodePipeline: string | null
  thumbKey: string | null
  thumbFailedAt: Date | null
}

interface SweepRenditionRow {
  clipId: string
  name: string
  isOg: boolean
  height: number
  fps: number
  codecs: string
}

interface SweepSummary {
  finishedAt: Date
  mode: RenditionsSweepPayload["mode"]
  scanned: number
  upToDate: number
  adopted: number
  enqueued: number
  unprobed: number
  quarantined: number
}

defineJobKind({
  kind: CLIP_RENDITIONS_SWEEP_KIND,
  queue: "maintenance",
  schema: RenditionsSweepPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 1, backoffMs: 60_000 },
  handler: runRenditionsSweep,
})

export function enqueueRenditionsSweep(
  mode: RenditionsSweepPayload["mode"],
  options: Pick<EnqueueOptions, "runAt"> = {},
): Promise<string> {
  return enqueue(
    CLIP_RENDITIONS_SWEEP_KIND,
    { mode },
    {
      dedupKey: CLIP_RENDITIONS_SWEEP_KIND,
      priority: 50,
      runAt: options.runAt,
    },
  )
}

async function runRenditionsSweep(
  payload: RenditionsSweepPayload,
  ctx: JobHandlerContext,
): Promise<void> {
  const config = configStore.get("transcoding")
  const summary: SweepSummary = {
    finishedAt: new Date(),
    mode: payload.mode,
    scanned: 0,
    upToDate: 0,
    adopted: 0,
    enqueued: 0,
    unprobed: 0,
    quarantined: 0,
  }
  let cursor: string | null = null

  for (;;) {
    if (ctx.signal.aborted) break
    const page = await selectSweepPage(cursor)
    if (page.length === 0) break
    cursor = page[page.length - 1]?.id ?? cursor

    if (payload.mode === "force") {
      for (const row of page) {
        summary.scanned += 1
        await enqueueClipEncode(row.id, { trigger: "reencode", priority: 90 })
        summary.enqueued += 1
      }
      continue
    }

    const renditionRows = await selectRenditionsForPage(
      page.map((row) => row.id),
    )

    for (const row of page) {
      summary.scanned += 1
      if (row.height === null || row.sourceFps === null) {
        summary.unprobed += 1
        await enqueueClipEncode(row.id, { trigger: "sweep", priority: 90 })
        summary.enqueued += 1
        continue
      }

      const facts = {
        height: row.height,
        sourceFps: row.sourceFps,
        sourceContentType: row.sourceContentType,
        sourceCodecs: row.sourceCodecs,
        trimStartMs: row.trimStartMs,
        trimEndMs: row.trimEndMs,
      }
      const expected = encodeFingerprint(config, facts)
      const ladder = expectedLadder(config, facts)

      if (row.encodeFingerprint === expected) {
        if (needsThumbnail(row)) {
          await enqueueClipEncode(row.id, { trigger: "sweep", priority: 90 })
          summary.enqueued += 1
        } else {
          summary.upToDate += 1
        }
        continue
      }

      if (row.encodeFailedFingerprint === expected) {
        summary.quarantined += 1
        continue
      }

      if (
        row.encodeFingerprint === null &&
        (await adoptMatchingRenditions({
          row,
          expected,
          ladder,
          renditions: renditionRows.get(row.id) ?? [],
        }))
      ) {
        summary.adopted += 1
        if (needsThumbnail(row)) {
          await enqueueClipEncode(row.id, { trigger: "sweep", priority: 90 })
          summary.enqueued += 1
        }
        continue
      }

      await enqueueClipEncode(row.id, { trigger: "sweep", priority: 90 })
      summary.enqueued += 1
    }
  }

  if (ctx.signal.aborted) return

  summary.finishedAt = new Date()
  await writeSweepSummary(summary)
  logger.info(
    `rendition sweep complete: mode=${summary.mode} scanned=${summary.scanned} upToDate=${summary.upToDate} adopted=${summary.adopted} enqueued=${summary.enqueued} unprobed=${summary.unprobed} quarantined=${summary.quarantined}`,
  )
}

async function selectSweepPage(cursor: string | null): Promise<SweepClipRow[]> {
  return db
    .select({
      id: clip.id,
      height: clip.height,
      sourceFps: clip.source_fps,
      sourceContentType: clip.source_content_type,
      sourceCodecs: clip.source_codecs,
      trimStartMs: clip.trim_start_ms,
      trimEndMs: clip.trim_end_ms,
      encodeFingerprint: clip.encode_fingerprint,
      encodeFailedFingerprint: clip.encode_failed_fingerprint,
      encodePipeline: clip.encode_pipeline,
      thumbKey: clip.thumb_key,
      thumbFailedAt: clip.thumb_failed_at,
    })
    .from(clip)
    .where(
      and(
        eq(clip.status, "ready"),
        isNotNull(clip.source_key),
        cursor ? gt(clip.id, cursor) : undefined,
      ),
    )
    .orderBy(clip.id)
    .limit(PAGE_SIZE)
}

function needsThumbnail(row: SweepClipRow): boolean {
  return row.thumbKey === null && row.thumbFailedAt === null
}

async function selectRenditionsForPage(
  clipIds: string[],
): Promise<Map<string, SweepRenditionRow[]>> {
  const rows =
    clipIds.length === 0
      ? []
      : await db
          .select({
            clipId: clipRendition.clip_id,
            name: clipRendition.name,
            isOg: clipRendition.is_og,
            height: clipRendition.height,
            fps: clipRendition.fps,
            codecs: clipRendition.codecs,
          })
          .from(clipRendition)
          .where(inArray(clipRendition.clip_id, clipIds))
  const byClip = new Map<string, SweepRenditionRow[]>()
  for (const row of rows) {
    byClip.set(row.clipId, [...(byClip.get(row.clipId) ?? []), row])
  }
  return byClip
}

// Adopt-in-place is a one-time amnesty for legacy rows that already look like
// the current ladder. Historical CRF/audio/maxrate settings cannot be proven
// from clip_rendition rows alone, but accepting exact names plus matching
// height/fps/codec avoids re-encoding an already-correct-looking library just
// because a config-triggered sweep sees a null fingerprint.
async function adoptMatchingRenditions(options: {
  row: SweepClipRow
  expected: string
  ladder: LadderStep[]
  renditions: SweepRenditionRow[]
}): Promise<boolean> {
  if (options.row.encodePipeline !== MEDIA_PIPELINE_VERSION) return false
  const fixes = adoptionFixes(options.renditions, options.ladder)
  if (!fixes) return false

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(clip)
      .set({
        encode_fingerprint: options.expected,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(clip.id, options.row.id),
          eq(clip.status, "ready"),
          isNull(clip.encode_run_id),
          isNull(clip.encode_fingerprint),
        ),
      )
      .returning({ id: clip.id })
    if (!updated) return false

    for (const fix of fixes) {
      await tx
        .update(clipRendition)
        .set({ is_og: fix.isOg })
        .where(
          and(
            eq(clipRendition.clip_id, options.row.id),
            eq(clipRendition.name, fix.name),
          ),
        )
    }
    return true
  })
}

function adoptionFixes(
  renditions: SweepRenditionRow[],
  ladder: LadderStep[],
): { name: string; isOg: boolean }[] | null {
  if (renditions.length !== ladder.length) return null
  const rowsByName = new Map(
    renditions.map((rendition) => [rendition.name, rendition]),
  )
  const fixes: { name: string; isOg: boolean }[] = []

  for (const step of ladder) {
    const rendition = rowsByName.get(step.name)
    if (!rendition) return null
    if (rendition.height !== step.height) return null
    if (Math.abs(rendition.fps - step.fps) > 1) return null
    if (codecFamily(rendition.codecs) !== step.codec) return null
    if (rendition.isOg !== step.og) {
      fixes.push({ name: rendition.name, isOg: step.og })
    }
  }

  return fixes
}

function codecFamily(codecs: string): LadderStep["codec"] | null {
  const video = codecs.split(",")[0]?.toLowerCase() ?? ""
  if (video.startsWith("avc1")) return "h264"
  if (video.startsWith("hvc1") || video.startsWith("hev1")) return "hevc"
  if (video.startsWith("av01")) return "av1"
  return null
}

async function writeSweepSummary(summary: SweepSummary): Promise<void> {
  await db
    .insert(instanceSetting)
    .values({ key: SWEEP_SUMMARY_KEY, value: summary, updated_at: new Date() })
    .onConflictDoUpdate({
      target: instanceSetting.key,
      set: { value: summary, updated_at: new Date() },
    })
}
