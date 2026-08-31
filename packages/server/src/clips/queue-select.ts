import { normalizeBlurHash, type QueueClip } from "@alloy/contracts"
import { clip, game } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { isoDate } from "@alloy/server/runtime/date"
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm"

import { clipAssetVersion } from "./asset-version"

const queueSelection = {
  id: clip.id,
  gameId: clip.game_id,
  gameSlug: game.slug,
  title: clip.title,
  status: clip.status,
  encodeActive: sql<boolean>`${clip.encode_request_id} is not null or ${clip.encode_run_id} is not null`,
  encodeProgress: clip.encode_progress,
  encodeStage: clip.encode_stage,
  encodeTier: clip.encode_tier,
  encodeTierIndex: clip.encode_tier_index,
  encodeTierCount: clip.encode_tier_count,
  failureReason: clip.failure_reason,
  thumbKey: clip.thumb_key,
  thumbBlurHash: clip.thumb_blur_hash,
  createdAt: clip.created_at,
  updatedAt: clip.updated_at,
} as const

function serialize(row: {
  id: string
  title: string
  status: (typeof clip.$inferSelect)["status"]
  encodeActive: boolean
  encodeProgress: number
  encodeStage: QueueClip["encodeStage"]
  encodeTier: string | null
  encodeTierIndex: number | null
  encodeTierCount: number | null
  failureReason: string | null
  thumbKey: string | null
  thumbBlurHash: string | null
  gameId: string | null
  gameSlug: string | null
  createdAt: Date
  updatedAt: Date
}): QueueClip {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    encodeActive: row.encodeActive,
    encodeProgress: row.encodeProgress,
    encodeStage: row.encodeStage,
    encodeTier: row.encodeTier,
    encodeTierIndex: row.encodeTierIndex,
    encodeTierCount: row.encodeTierCount,
    failureReason: row.failureReason,
    gameSlug: row.gameSlug,
    hasThumb: row.thumbKey !== null,
    thumbVersion: row.thumbKey ? clipAssetVersion(row.thumbKey) : null,
    thumbBlurHash: normalizeBlurHash(row.thumbBlurHash),
    gameId: row.gameId,
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
  }
}

/**
 * Snapshot sent when the queue opens or reconnects. Active work is always
 * included, even for clips older than the 50-row recent history.
 */
export async function selectQueueRowsForAuthor(
  authorId: string,
): Promise<QueueClip[]> {
  const activeCondition = or(
    isNotNull(clip.encode_request_id),
    isNotNull(clip.encode_run_id),
  )
  const [active, recent] = await Promise.all([
    db
      .select(queueSelection)
      .from(clip)
      .leftJoin(game, eq(clip.game_id, game.id))
      .where(and(eq(clip.author_id, authorId), activeCondition))
      .orderBy(desc(clip.updated_at)),
    db
      .select(queueSelection)
      .from(clip)
      .leftJoin(game, eq(clip.game_id, game.id))
      .where(eq(clip.author_id, authorId))
      .orderBy(desc(clip.created_at))
      .limit(50),
  ])
  const activeIds = new Set(active.map((row) => row.id))
  return [...active, ...recent.filter((row) => !activeIds.has(row.id))].map(
    (row) => serialize(row),
  )
}

export async function selectQueueRowById(
  clipId: string,
): Promise<QueueClip | null> {
  const [row] = await db
    .select(queueSelection)
    .from(clip)
    .leftJoin(game, eq(clip.game_id, game.id))
    .where(eq(clip.id, clipId))
    .limit(1)
  return row ? serialize(row) : null
}
