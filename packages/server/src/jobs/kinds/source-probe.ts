import { clip } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { persistedSourceFps } from "@alloy/server/media/encode-fingerprint"
import { faststartPath } from "@alloy/server/media/mp4-layout"
import { probeMedia, sourceCodecsString } from "@alloy/server/media/probe"
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm"
import { z } from "zod"

import { runScopedSourceKey } from "../../queue/media-asset-keys"
import { withClipSourceWorkDir } from "../../queue/media-run-helpers"
import { join } from "../../runtime/path"
import { clipStorage } from "../../storage"
import { EmptyPayloadSchema } from "../payloads"
import { defineJobKind, type JobHandlerContext } from "../registry"
import { enqueue } from "../store"

const CLIP_SOURCE_PROBE_SWEEP_KIND = "clip.source-probe-sweep"
const CLIP_SOURCE_PROBE_KIND = "clip.source-probe"
const EVERY_DAY_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 500

const SourceProbePayloadSchema = z.object({ clipId: z.uuid() })

type SourceProbePayload = z.infer<typeof SourceProbePayloadSchema>

interface SourceProbeRow {
  id: string
  sourceKey: string
  sourceContentType: string | null
}

defineJobKind({
  kind: CLIP_SOURCE_PROBE_SWEEP_KIND,
  queue: "maintenance",
  schema: EmptyPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 1, backoffMs: 60_000 },
  schedule: { everyMs: EVERY_DAY_MS, runAtBoot: true },
  handler: runSourceProbeSweep,
})

defineJobKind({
  kind: CLIP_SOURCE_PROBE_KIND,
  queue: "io",
  schema: SourceProbePayloadSchema,
  defaultPriority: 60,
  retry: { maxAttempts: 2, backoffMs: 60_000 },
  handler: runSourceProbe,
})

async function runSourceProbeSweep(
  _payload: z.infer<typeof EmptyPayloadSchema>,
  ctx: JobHandlerContext,
): Promise<void> {
  let cursor: string | null = null
  for (;;) {
    if (ctx.signal.aborted) return
    const page = await selectSourceProbePage(cursor)
    if (page.length === 0) return
    cursor = page[page.length - 1]?.id ?? cursor
    for (const row of page) {
      await enqueue(
        CLIP_SOURCE_PROBE_KIND,
        { clipId: row.id },
        {
          dedupKey: row.id,
          priority: 60,
        },
      )
    }
  }
}

async function runSourceProbe(payload: SourceProbePayload): Promise<void> {
  const row = await selectSourceProbeRow(payload.clipId)
  if (!row) return
  await backfillSourceProbe(row)
}

async function selectSourceProbePage(
  cursor: string | null,
): Promise<{ id: string }[]> {
  return db
    .select({ id: clip.id })
    .from(clip)
    .where(
      and(
        eq(clip.status, "ready"),
        isNotNull(clip.source_key),
        isNull(clip.source_fps),
        cursor ? gt(clip.id, cursor) : undefined,
      ),
    )
    .orderBy(clip.id)
    .limit(PAGE_SIZE)
}

async function selectSourceProbeRow(
  clipId: string,
): Promise<SourceProbeRow | null> {
  const [row] = await db
    .select({
      id: clip.id,
      sourceKey: clip.source_key,
      sourceContentType: clip.source_content_type,
    })
    .from(clip)
    .where(
      and(
        eq(clip.id, clipId),
        eq(clip.status, "ready"),
        isNotNull(clip.source_key),
        isNull(clip.source_fps),
      ),
    )
    .limit(1)
  if (!row?.sourceKey) return null
  return { ...row, sourceKey: row.sourceKey }
}

function backfillSourceProbe(
  row: SourceProbeRow,
): Promise<{ remuxed: boolean } | null> {
  return withClipSourceWorkDir(
    `probe-${row.id}`,
    row.sourceKey,
    async ({ workDir, sourcePath }) => {
      const probePath = await faststartPath(
        sourcePath,
        join(workDir, "source-faststart.mp4"),
        row.sourceContentType,
      )
      const remuxedKey =
        probePath === sourcePath
          ? null
          : runScopedSourceKey(row.id, crypto.randomUUID())

      const probe = await probeMedia(probePath)
      const uploaded = remuxedKey
        ? await clipStorage.uploadFromFile(probePath, remuxedKey, "video/mp4")
        : null

      // Guarded on the row still being idle with the same source so a trim
      // run that started meanwhile (which writes this metadata itself) wins.
      const [accepted] = await db
        .update(clip)
        .set({
          source_codecs: sourceCodecsString(probe),
          source_duration_ms: probe.durationMs,
          source_fps: persistedSourceFps(probe.fps),
          ...(remuxedKey && uploaded
            ? { source_key: remuxedKey, source_size_bytes: uploaded.size }
            : {}),
          updated_at: new Date(),
        })
        .where(
          and(
            eq(clip.id, row.id),
            eq(clip.status, "ready"),
            isNull(clip.encode_run_id),
            eq(clip.source_key, row.sourceKey),
          ),
        )
        .returning({ id: clip.id })
      if (!accepted) {
        if (remuxedKey) await clipStorage.delete(remuxedKey)
        return null
      }

      if (remuxedKey) await clipStorage.delete(row.sourceKey)
      return { remuxed: remuxedKey !== null }
    },
  )
}
