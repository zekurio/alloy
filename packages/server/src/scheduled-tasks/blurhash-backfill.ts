import { mkdir, mkdtemp, rm } from "node:fs/promises"

import { clip, game } from "alloy-db/schema"
import { logger } from "alloy-logging"
import { and, eq, isNotNull, isNull, or } from "drizzle-orm"

import { publishClipUpsert } from "../clips/events"
import { db } from "../db"
import { imageBlurHash } from "../media/blurhash"
import { ENCODE_DIR } from "../runtime/dirs"
import { join } from "../runtime/path"
import { clipStorage } from "../storage"
import type { ScheduledTask, ScheduledTaskResult } from "./types"

const BLURHASH_BACKFILL_CRON = "30 */6 * * *"
const BLURHASH_BACKFILL_STARTUP_DELAY_MS = 90 * 1000
const BLURHASH_BACKFILL_STARTUP_JITTER_MS = 30 * 1000
const BLURHASH_BACKFILL_CRON_JITTER_MS = 120 * 1000

export const clipBlurHashBackfillTask: ScheduledTask = {
  id: "clip-blurhash-backfill",
  name: "Clip BlurHash backfill",
  description: "Backfills BlurHash metadata for ready clip thumbnails.",
  triggers: [
    {
      type: "startup",
      delayMs: BLURHASH_BACKFILL_STARTUP_DELAY_MS,
      jitterMs: BLURHASH_BACKFILL_STARTUP_JITTER_MS,
    },
    {
      type: "cron",
      expression: BLURHASH_BACKFILL_CRON,
      jitterMs: BLURHASH_BACKFILL_CRON_JITTER_MS,
    },
  ],
  run: async ({ signal }): Promise<ScheduledTaskResult> => {
    return await backfillClipBlurHashes(signal)
  },
}

export const gameBlurHashBackfillTask: ScheduledTask = {
  id: "game-blurhash-backfill",
  name: "Game BlurHash backfill",
  description:
    "Backfills BlurHash metadata for cached game hero and grid images.",
  triggers: [
    {
      type: "startup",
      delayMs: BLURHASH_BACKFILL_STARTUP_DELAY_MS,
      jitterMs: BLURHASH_BACKFILL_STARTUP_JITTER_MS,
    },
    {
      type: "cron",
      expression: BLURHASH_BACKFILL_CRON,
      jitterMs: BLURHASH_BACKFILL_CRON_JITTER_MS,
    },
  ],
  run: async ({ signal }): Promise<ScheduledTaskResult> => {
    return await backfillGameBlurHashes(signal)
  },
}

async function backfillClipBlurHashes(
  signal: AbortSignal,
): Promise<ScheduledTaskResult> {
  const rows = await db
    .select({
      id: clip.id,
      authorId: clip.authorId,
      thumbKey: clip.thumbKey,
    })
    .from(clip)
    .where(
      and(
        eq(clip.status, "ready"),
        isNotNull(clip.thumbKey),
        isNull(clip.thumbBlurHash),
      ),
    )
    .orderBy(clip.createdAt)

  await mkdir(ENCODE_DIR, { recursive: true })
  const scratchDir = await mkdtemp(`${ENCODE_DIR}/clip-blurhash-task-`)
  let clipThumbsScanned = 0
  let clipBlurHashesCreated = 0
  let clipBlurHashFailures = 0

  try {
    for (const row of rows) {
      throwIfAborted(signal)
      clipThumbsScanned += 1
      if (!row.thumbKey) continue

      const thumbPath = join(scratchDir, `${row.id}.webp`)
      try {
        await clipStorage.downloadToFile(row.thumbKey, thumbPath)
        const thumbBlurHash = await imageBlurHash({
          source: thumbPath,
          label: "clip thumbnail blurhash backfill",
          signal,
        })
        const [updated] = await db
          .update(clip)
          .set({ thumbBlurHash })
          .where(
            and(
              eq(clip.id, row.id),
              eq(clip.status, "ready"),
              eq(clip.thumbKey, row.thumbKey),
              isNull(clip.thumbBlurHash),
            ),
          )
          .returning({ id: clip.id })
        if (!updated) continue
        clipBlurHashesCreated += 1
        void publishClipUpsert(row.authorId, row.id)
      } catch (err) {
        if (signal.aborted) throw err
        clipBlurHashFailures += 1
        logger.warn(
          `[scheduled-tasks] failed to backfill clip blurhash for ${row.id}:`,
          err,
        )
      } finally {
        await rm(thumbPath, { force: true }).catch(() => undefined)
      }
    }
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
  }

  return {
    clipThumbsScanned,
    clipBlurHashesCreated,
    clipBlurHashFailures,
  }
}

async function backfillGameBlurHashes(
  signal: AbortSignal,
): Promise<ScheduledTaskResult> {
  const rows = await db
    .select({
      steamgriddbId: game.steamgriddbId,
      heroUrl: game.heroUrl,
      heroBlurHash: game.heroBlurHash,
      gridUrl: game.gridUrl,
      gridBlurHash: game.gridBlurHash,
    })
    .from(game)
    .where(
      or(
        and(isNotNull(game.heroUrl), isNull(game.heroBlurHash)),
        and(isNotNull(game.gridUrl), isNull(game.gridBlurHash)),
      ),
    )
    .orderBy(game.name)

  let gamesScanned = 0
  let gameBlurHashesCreated = 0
  let gameBlurHashFailures = 0

  for (const row of rows) {
    throwIfAborted(signal)
    gamesScanned += 1

    const patch: {
      heroBlurHash?: string
      gridBlurHash?: string
    } = {}

    if (row.heroUrl && !row.heroBlurHash) {
      const hash = await computeGameBlurHash(
        "hero",
        row.steamgriddbId,
        row.heroUrl,
        signal,
      )
      if (hash) patch.heroBlurHash = hash
      else gameBlurHashFailures += 1
    }

    if (row.gridUrl && !row.gridBlurHash) {
      const hash = await computeGameBlurHash(
        "grid",
        row.steamgriddbId,
        row.gridUrl,
        signal,
      )
      if (hash) patch.gridBlurHash = hash
      else gameBlurHashFailures += 1
    }

    if (patch.heroBlurHash || patch.gridBlurHash) {
      const [updated] = await db
        .update(game)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(game.steamgriddbId, row.steamgriddbId),
            row.heroUrl ? eq(game.heroUrl, row.heroUrl) : undefined,
            row.gridUrl ? eq(game.gridUrl, row.gridUrl) : undefined,
          ),
        )
        .returning({ id: game.steamgriddbId })
      if (updated) {
        gameBlurHashesCreated += Object.keys(patch).length
      }
    }
  }

  return {
    gamesScanned,
    gameBlurHashesCreated,
    gameBlurHashFailures,
  }
}

async function computeGameBlurHash(
  label: "hero" | "grid",
  steamgriddbId: number,
  url: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    return await imageBlurHash({
      source: url,
      label: `game ${label} blurhash backfill`,
      signal,
    })
  } catch (err) {
    if (signal.aborted) throw err
    logger.warn(
      `[scheduled-tasks] failed to backfill ${label} blurhash for game ${steamgriddbId}:`,
      err,
    )
    return null
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Scheduled task cancelled", "AbortError")
  }
}
