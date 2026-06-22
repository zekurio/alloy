import { normalizeBlurHash, type ClipMentionRef } from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, clipMention, clipTag, game } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import {
  clipGameRefFromSnapshot,
  gameSelectShape,
  serialiseGameRow,
} from "@alloy/server/games/ref"
import { eq, sql } from "drizzle-orm"

import { clipThumbnailVersion } from "./thumbnail-version"

export const clipSelectShape = {
  id: clip.id,
  authorId: clip.author_id,
  title: clip.title,
  description: clip.description,
  game: clip.game,
  gameId: clip.game_id,
  privacy: clip.privacy,
  sourceKey: clip.source_key,
  sourceContentType: clip.source_content_type,
  sourceVideoCodec: clip.source_video_codec,
  sourceAudioCodec: clip.source_audio_codec,
  sourceSizeBytes: clip.source_size_bytes,
  durationMs: clip.duration_ms,
  width: clip.width,
  height: clip.height,
  thumbKey: clip.thumb_key,
  thumbBlurHash: clip.thumb_blur_hash,
  viewCount: clip.view_count,
  likeCount: clip.like_count,
  commentCount: clip.comment_count,
  status: clip.status,
  encodeProgress: clip.encode_progress,
  failureReason: clip.failure_reason,
  createdAt: clip.created_at,
  updatedAt: clip.updated_at,
  authorUsername: user.username,
  authorImage: user.image,
  gameRef: gameSelectShape,
  // Bare, lowercase tags aggregated from the join table so every list/detail
  // read returns them without a second round-trip.
  tags: sql<
    string[]
  >`coalesce((select array_agg(${clipTag.tag} order by ${clipTag.tag}) from ${clipTag} where ${clipTag.clip_id} = ${clip.id}), '{}')`,
} as const

async function selectClipMentions(clipId: string): Promise<ClipMentionRef[]> {
  return db
    .select({
      id: user.id,
      username: user.username,
      displayUsername: user.display_username,
      image: user.image,
    })
    .from(clipMention)
    .innerJoin(user, eq(clipMention.mentioned_user_id, user.id))
    .where(eq(clipMention.clip_id, clipId))
    .orderBy(user.username)
}

export async function selectClipById(id: string) {
  const [row] = await db
    .select(clipSelectShape)
    .from(clip)
    .innerJoin(user, eq(clip.author_id, user.id))
    .leftJoin(game, eq(clip.game_id, game.id))
    .where(eq(clip.id, id))
    .limit(1)
  if (!row) return null
  const mentions = await selectClipMentions(id)
  return { ...row, mentions }
}

export function toPublicClipRow<
  T extends {
    sourceKey: string | null
    sourceContentType: string | null
    sourceVideoCodec: string | null
    sourceAudioCodec: string | null
    sourceSizeBytes: number | null
    durationMs: number | null
    width: number | null
    height: number | null
    thumbKey: string | null
    thumbBlurHash: string | null
    gameId: string | null
    game: string | null
    gameRef?: Parameters<typeof serialiseGameRow>[0] | null
  },
>(row: T) {
  const { sourceKey: _sourceKey, gameRef, ...rest } = row
  const thumbVersion = row.thumbKey ? clipThumbnailVersion(row.thumbKey) : null
  return {
    ...rest,
    gameRef: gameRef
      ? serialiseGameRow(gameRef)
      : row.gameId !== null
        ? clipGameRefFromSnapshot({
            id: row.gameId,
            name: row.game,
          })
        : null,
    thumbKey: thumbVersion ? "thumbnail" : null,
    thumbVersion,
    thumbBlurHash: thumbVersion ? normalizeBlurHash(row.thumbBlurHash) : null,
  }
}
