import { MEDIA_FILTERS, type ProfileMediaParams } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { user } from "@alloy/db/auth-schema"
import { clip, clipLike, clipMention, game } from "@alloy/db/schema"
import { getSession } from "@alloy/server/auth/session"
import { clipAccessCondition } from "@alloy/server/clips/access"
import { clipSelection, toPublicClipRow } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { gameSelection, serialiseGameRow } from "@alloy/server/games/ref"
import { and, asc, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm"
import type { Context } from "hono"

import { publicClipPrivacyCondition, mediaKindCondition } from "./clips-helpers"
import { serialiseProfileGameRow } from "./games-helpers"
import type { UserRow } from "./users-helpers"
import { limitQueryParam, offsetQueryParam } from "./validation"

// Owner uploads can lack a publish stamp; public rows always have one.
const clipListingTime = sql`coalesce(${clip.published_at}, ${clip.created_at})`

export const UserGamesQuery = t.object({
  limit: limitQueryParam(48, 24),
  offset: offsetQueryParam(),
})

export const UserMediaQuery = t.object({
  tab: t.enum(["all", "liked", "tagged"]).$default("all"),
  media: t.enum(MEDIA_FILTERS).$default("all"),
  sort: t.enum(["recent", "oldest", "top", "views"]).$default("recent"),
  game: t.string().max(200).optional(),
  limit: limitQueryParam(50, 30),
  offset: offsetQueryParam(),
})

function mediaFilters(options?: ProfileMediaParams) {
  return [
    mediaKindCondition(options?.media ?? "video"),
    options?.game ? eq(game.slug, options.game) : undefined,
  ]
}

function mediaOrder(options: ProfileMediaParams | undefined, fallback: SQL) {
  if (!options) return [fallback]
  const date =
    options.sort === "oldest" ? asc(clipListingTime) : desc(clipListingTime)
  return [
    ...(options.sort === "top"
      ? [desc(clip.like_count)]
      : options.sort === "views"
        ? [desc(clip.view_count)]
        : []),
    date,
    clip.id,
  ]
}

export async function listUserClips(
  row: UserRow,
  c: Context,
  options?: ProfileMediaParams,
) {
  const conditions = await visibleClipConditions(row, c, {
    includeOwnerUploads: true,
  })

  const rows = await db
    .select(clipSelection)
    .from(clip)
    .innerJoin(user, eq(clip.author_id, user.id))
    .leftJoin(game, eq(clip.game_id, game.id))
    .where(and(...conditions, ...mediaFilters(options)))
    .orderBy(...mediaOrder(options, desc(clipListingTime)))
    .limit(options?.limit ?? 50)
    .offset(options?.offset ?? 0)
  return rows.map(toPublicClipRow)
}

export async function listUserGames(
  row: UserRow,
  c: Context,
  { limit, offset }: t.infer<typeof UserGamesQuery>,
) {
  const conditions = await visibleClipConditions(row, c)

  const lastClippedAt = sql<Date>`max(${clipListingTime})`

  const rows = await db
    .select({
      ...gameSelection,
      clipCount: sql<number>`count(${clip.id})::int`,
      lastClippedAt,
    })
    .from(clip)
    .innerJoin(user, eq(clip.author_id, user.id))
    .innerJoin(game, eq(clip.game_id, game.id))
    .where(and(...conditions))
    .groupBy(game.id)
    .orderBy(sql`${lastClippedAt} desc`, game.name)
    .limit(limit)
    .offset(offset)

  return rows.map((row) =>
    serialiseProfileGameRow({
      ...serialiseGameRow(row),
      clipCount: row.clipCount,
      lastClippedAt: row.lastClippedAt,
    }),
  )
}

async function visibleClipConditions(
  row: UserRow,
  c: Context,
  { includeOwnerUploads = false }: { includeOwnerUploads?: boolean } = {},
): Promise<SQL[]> {
  const session = await getSession(c)
  const activeUser = session?.user.status === "active" ? session.user : null
  const isOwner = activeUser?.id === row.id
  const isAdmin = activeUser?.role === "admin"
  const canSeeUploads = includeOwnerUploads && (isOwner || isAdmin)
  const conditions: SQL[] = [
    eq(clip.author_id, row.id),
    canSeeUploads
      ? inArray(clip.status, ["pending", "processing", "ready", "failed"])
      : eq(clip.status, "ready"),
    isNull(user.disabled_at),
  ]
  if (!isOwner && !isAdmin) {
    conditions.push(publicClipPrivacyCondition())
  }
  return conditions
}

export async function listTaggedClips(
  row: UserRow,
  c: Context,
  options?: ProfileMediaParams,
) {
  const session = await getSession(c)
  const isAdmin =
    session?.user.status === "active" && session.user.role === "admin"

  const conditions: SQL[] = [
    eq(clipMention.mentioned_user_id, row.id),
    eq(clip.status, "ready"),
    isNull(user.disabled_at),
  ]
  if (!isAdmin) {
    conditions.push(publicClipPrivacyCondition())
  }

  const rows = await db
    .select(clipSelection)
    .from(clipMention)
    .innerJoin(clip, eq(clipMention.clip_id, clip.id))
    .innerJoin(user, eq(clip.author_id, user.id))
    .leftJoin(game, eq(clip.game_id, game.id))
    .where(and(...conditions, ...mediaFilters(options)))
    .orderBy(...mediaOrder(options, desc(clipListingTime)))
    .limit(options?.limit ?? 50)
    .offset(options?.offset ?? 0)
  return rows.map(toPublicClipRow)
}

export async function listLikedClips(
  row: UserRow,
  c: Context,
  options?: ProfileMediaParams,
) {
  const session = await getSession(c)
  const activeUser = session?.user.status === "active" ? session.user : null
  const isOwner = activeUser?.id === row.id
  const isAdmin = activeUser?.role === "admin"

  const conditions: SQL[] = [
    eq(clipLike.user_id, row.id),
    eq(clip.status, "ready"),
    isNull(user.disabled_at),
  ]
  if (isOwner) {
    // Liking required link access, so owners keep unlisted clips in their own
    // list. Current clip access still hides another author's private clip.
    conditions.push(clipAccessCondition(activeUser, "engagement"))
  } else if (!isAdmin) {
    // Other profile viewers only see discoverable clips.
    conditions.push(publicClipPrivacyCondition())
  }

  const rows = await db
    .select(clipSelection)
    .from(clipLike)
    .innerJoin(clip, eq(clipLike.clip_id, clip.id))
    .innerJoin(user, eq(clip.author_id, user.id))
    .leftJoin(game, eq(clip.game_id, game.id))
    .where(and(...conditions, ...mediaFilters(options)))
    .orderBy(...mediaOrder(options, desc(clipLike.created_at)))
    .limit(options?.limit ?? 50)
    .offset(options?.offset ?? 0)
  return rows.map(toPublicClipRow)
}
