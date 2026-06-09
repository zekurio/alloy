import type { ClipMentionRef } from "alloy-contracts"
import { user } from "alloy-db/auth-schema"
import { clip, clipMention, game } from "alloy-db/schema"
import { eq } from "drizzle-orm"

import { configStore } from "../config/store"
import { db } from "../db"
import {
  clipGameRefFromSnapshot,
  gameSelectShape,
  serialiseGameRow,
} from "../games/ref"
import { buildPlaybackQualities } from "./playback-quality"

export const clipSelectShape = {
  id: clip.id,
  authorId: clip.authorId,
  title: clip.title,
  description: clip.description,
  game: clip.game,
  steamgriddbId: clip.steamgriddbId,
  privacy: clip.privacy,
  sourceKey: clip.sourceKey,
  sourceContentType: clip.sourceContentType,
  sourceVideoCodec: clip.sourceVideoCodec,
  sourceAudioCodec: clip.sourceAudioCodec,
  sourceSizeBytes: clip.sourceSizeBytes,
  openGraphKey: clip.openGraphKey,
  openGraphContentType: clip.openGraphContentType,
  openGraphSizeBytes: clip.openGraphSizeBytes,
  durationMs: clip.durationMs,
  width: clip.width,
  height: clip.height,
  variants: clip.variants,
  thumbKey: clip.thumbKey,
  viewCount: clip.viewCount,
  likeCount: clip.likeCount,
  commentCount: clip.commentCount,
  status: clip.status,
  encodeProgress: clip.encodeProgress,
  failureReason: clip.failureReason,
  createdAt: clip.createdAt,
  updatedAt: clip.updatedAt,
  authorUsername: user.username,
  authorName: user.name,
  authorImage: user.image,
  gameRef: gameSelectShape,
} as const

async function selectClipMentions(clipId: string): Promise<ClipMentionRef[]> {
  return db
    .select({
      id: user.id,
      username: user.username,
      displayUsername: user.displayUsername,
      name: user.name,
      image: user.image,
    })
    .from(clipMention)
    .innerJoin(user, eq(clipMention.mentionedUserId, user.id))
    .where(eq(clipMention.clipId, clipId))
    .orderBy(user.username)
}

export async function selectClipById(id: string) {
  const [row] = await db
    .select(clipSelectShape)
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .innerJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
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
    openGraphKey: string | null
    sourceSizeBytes: number | null
    durationMs: number | null
    width: number | null
    height: number | null
    thumbKey: string | null
    variants: readonly { storageKey: string; hls?: unknown }[]
    steamgriddbId: number
    game: string | null
    gameRef?: Parameters<typeof serialiseGameRow>[0] | null
  },
>(row: T) {
  const {
    sourceKey: _sourceKey,
    openGraphKey: _openGraphKey,
    variants: _variants,
    gameRef,
    ...rest
  } = row
  return {
    ...rest,
    gameRef: gameRef
      ? serialiseGameRow(gameRef)
      : clipGameRefFromSnapshot({
          steamgriddbId: row.steamgriddbId,
          name: row.game,
        }),
    thumbKey: row.thumbKey ? "thumbnail" : null,
    playbackQualities: configStore.get("encoder").enabled
      ? buildPlaybackQualities(row)
      : [],
  }
}
