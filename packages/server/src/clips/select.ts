import { normalizeBlurHash, type ClipMentionRef } from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import {
  clip,
  clipMention,
  clipRendition,
  clipTag,
  game,
} from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import {
  clipGameRefFromSnapshot,
  gameSelectShape,
  serialiseGameRow,
} from "@alloy/server/games/ref"
import { eq, sql } from "drizzle-orm"

import { clipAssetVersion } from "./asset-version"

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
  // Committed quality tiers, highest first. Keys are aggregated for version
  // derivation and stripped before the row leaves the server.
  renditionRows: sql<
    {
      height: number
      width: number
      fps: number
      key: string
      codecs: string
    }[]
  >`coalesce((select json_agg(json_build_object('height', ${clipRendition.height}, 'width', ${clipRendition.width}, 'fps', ${clipRendition.fps}, 'key', ${clipRendition.storage_key}, 'codecs', ${clipRendition.codecs}) order by ${clipRendition.height} desc) from ${clipRendition} where ${clipRendition.clip_id} = ${clip.id}), '[]'::json)`,
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
    renditionRows?: {
      height: number
      width: number
      fps: number
      key: string
      codecs: string
    }[]
  },
>(row: T) {
  const { sourceKey: _sourceKey, gameRef, renditionRows, ...rest } = row
  const thumbVersion = row.thumbKey ? clipAssetVersion(row.thumbKey) : null
  const renditions = (renditionRows ?? []).map((rendition) => ({
    height: rendition.height,
    width: rendition.width,
    fps: rendition.fps,
    version: clipAssetVersion(rendition.key),
  }))
  return {
    ...rest,
    // Derived from the storage key so it changes exactly when a republish
    // (trim, remux) swaps the bytes — the key itself never leaves the server.
    sourceVersion: row.sourceKey ? clipAssetVersion(row.sourceKey) : null,
    renditions,
    playbackVersion: playbackVersionFromKeys(
      (renditionRows ?? []).map((rendition) => rendition.key),
    ),
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

/**
 * Version for playlist URLs, derived from the full rendition key set so both
 * a re-encode and a ladder change bust caches. Must match the computation in
 * the playback routes.
 */
export function playbackVersionFromKeys(
  keys: readonly string[],
): string | null {
  if (keys.length === 0) return null
  return clipAssetVersion([...keys].sort().join(","))
}
