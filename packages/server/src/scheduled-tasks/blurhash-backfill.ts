import { game } from "@alloy/db/schema"
import { logger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { imageBlurHash } from "@alloy/server/media/blurhash"
import { and, eq, isNotNull, isNull, or } from "drizzle-orm"

import { startupAndCronTriggers } from "./triggers"
import type { ScheduledTask, ScheduledTaskResult } from "./types"

const BLURHASH_BACKFILL_TRIGGERS = startupAndCronTriggers({
  startupDelayMs: 90 * 1000,
  cronExpression: "30 */6 * * *",
})

export const gameBlurHashBackfillTask: ScheduledTask = {
  id: "game-blurhash-backfill",
  name: "Game BlurHash backfill",
  description:
    "Backfills BlurHash metadata for cached game hero and grid images.",
  triggers: BLURHASH_BACKFILL_TRIGGERS,
  run: async ({ signal }): Promise<ScheduledTaskResult> => {
    return await backfillGameBlurHashes(signal)
  },
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
