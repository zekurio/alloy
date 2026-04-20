import { eq } from "drizzle-orm"

import { clip, game, user } from "@workspace/db/schema"

import { db } from "../db"

/**
 * Shared clip read projection. Every endpoint that emits a clip row
 * selects this exact shape — so the home feed, single-clip GET, game
 * page, and queue detail all surface matching `ClipRow` shapes on the
 * client. Adding a column to a clip response means touching this file
 * and nothing else.
 *
 * We keep the legacy free-text `clip.game` column selectable so old
 * rows render their label, and add the `gameRef` nested projection
 * for the new FK'd metadata. Drizzle's left join already collapses
 * `gameRef` to `null` when the clip has no mapped game, so callers
 * can branch on a single nullish check. The UI prefers `gameRef`
 * when present and falls back to `game` text otherwise.
 */

export const clipSelectShape = {
  id: clip.id,
  slug: clip.slug,
  authorId: clip.authorId,
  title: clip.title,
  description: clip.description,
  game: clip.game,
  gameId: clip.gameId,
  privacy: clip.privacy,
  storageKey: clip.storageKey,
  contentType: clip.contentType,
  sizeBytes: clip.sizeBytes,
  durationMs: clip.durationMs,
  width: clip.width,
  height: clip.height,
  trimStartMs: clip.trimStartMs,
  trimEndMs: clip.trimEndMs,
  variants: clip.variants,
  thumbKey: clip.thumbKey,
  thumbSmallKey: clip.thumbSmallKey,
  viewCount: clip.viewCount,
  likeCount: clip.likeCount,
  commentCount: clip.commentCount,
  status: clip.status,
  encodeProgress: clip.encodeProgress,
  failureReason: clip.failureReason,
  createdAt: clip.createdAt,
  updatedAt: clip.updatedAt,
  authorUsername: user.username,
  authorImage: user.image,
  gameRef: {
    id: game.id,
    steamgriddbId: game.steamgriddbId,
    slug: game.slug,
    name: game.name,
    heroUrl: game.heroUrl,
    logoUrl: game.logoUrl,
  },
} as const

export type ClipGameRef = {
  id: string
  steamgriddbId: number
  slug: string
  name: string
  heroUrl: string | null
  logoUrl: string | null
}

/**
 * Single-row lookup shared between `/:id`, `/finalize`, and PATCH.
 * Returns `null` when the clip doesn't exist so callers can branch
 * cleanly on the 404 path.
 */
export async function selectClipById(id: string) {
  const [row] = await db
    .select(clipSelectShape)
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .leftJoin(game, eq(clip.gameId, game.id))
    .where(eq(clip.id, id))
    .limit(1)
  return row ?? null
}
