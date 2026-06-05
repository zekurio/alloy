import type { ClipMentionRef } from "@workspace/contracts"
import { user } from "@workspace/db/auth-schema"
import { clip, clipMention, game } from "@workspace/db/schema"
import { eq } from "drizzle-orm"

import { configStore } from "../config/store"
import { db } from "../db"
import { buildPlaybackQualities } from "./playback-quality"

export const clipSelectShape = {
  id: clip.id,
  authorId: clip.authorId,
  title: clip.title,
  description: clip.description,
  game: clip.game,
  gameId: clip.gameId,
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
  gameRef: {
    id: game.id,
    steamgriddbId: game.steamgriddbId,
    slug: game.slug,
    name: game.name,
    releaseDate: game.releaseDate,
    heroUrl: game.heroUrl,
    gridUrl: game.gridUrl,
    logoUrl: game.logoUrl,
    iconUrl: game.iconUrl,
  },
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
    .leftJoin(game, eq(clip.gameId, game.id))
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
  },
>(row: T) {
  const {
    sourceKey: _sourceKey,
    openGraphKey: _openGraphKey,
    variants: _variants,
    ...rest
  } = row
  return {
    ...rest,
    thumbKey: row.thumbKey ? "thumbnail" : null,
    playbackQualities: configStore.get("encoder").enabled
      ? buildPlaybackQualities(row)
      : [],
  }
}
