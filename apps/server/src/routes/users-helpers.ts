import { and, desc, eq, inArray, type SQL } from "drizzle-orm"
import { z } from "zod"

import type { PublicUser } from "@workspace/db/contracts"
import { user } from "@workspace/db/auth-schema"
import { clip, clipMention, follow, game } from "@workspace/db/schema"

import { getAuth } from "../auth"
import { db } from "../db"
import { clipSelectShape } from "../lib/clip-select"

export const UsernameParam = z.object({ username: z.string().min(1) })

export const SearchQuery = z.object({
  q: z.string().min(1).max(64),
  limit: z.coerce.number().int().positive().max(20).default(8),
})

export function toLikePattern(raw: string): string {
  const escaped = raw
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
  return `%${escaped}%`
}

export type UserRow = typeof user.$inferSelect

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name ?? "",
    image: row.image,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function resolveTarget(segment: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.username, segment.toLowerCase()))
    .limit(1)
  return row ?? null
}

export async function listUserClips(row: UserRow, headers: Headers) {
  const session = await getAuth().api.getSession({ headers })
  const isOwner = session?.user.id === row.id
  const isAdmin =
    (session?.user as { role?: string | null } | undefined)?.role === "admin"
  const conditions: SQL[] = [
    eq(clip.authorId, row.id),
    eq(clip.status, "ready"),
  ]
  if (!isOwner && !isAdmin) {
    conditions.push(inArray(clip.privacy, ["public", "unlisted"]))
  }

  return db
    .select(clipSelectShape)
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .leftJoin(game, eq(clip.gameId, game.id))
    .where(and(...conditions))
    .orderBy(desc(clip.createdAt))
    .limit(50)
}

export async function listTaggedClips(row: UserRow, headers: Headers) {
  const session = await getAuth().api.getSession({ headers })
  const isAdmin =
    (session?.user as { role?: string | null } | undefined)?.role === "admin"

  const conditions: SQL[] = [
    eq(clipMention.mentionedUserId, row.id),
    eq(clip.status, "ready"),
  ]
  if (!isAdmin) {
    conditions.push(inArray(clip.privacy, ["public", "unlisted"]))
  }

  return db
    .select(clipSelectShape)
    .from(clipMention)
    .innerJoin(clip, eq(clipMention.clipId, clip.id))
    .innerJoin(user, eq(clip.authorId, user.id))
    .leftJoin(game, eq(clip.gameId, game.id))
    .where(and(...conditions))
    .orderBy(desc(clip.createdAt))
    .limit(50)
}

export function listFollowers(row: UserRow) {
  return db
    .select({
      id: user.id,
      username: user.username,
      displayUsername: user.displayUsername,
      name: user.name,
      image: user.image,
    })
    .from(follow)
    .innerJoin(user, eq(user.id, follow.followerId))
    .where(eq(follow.followingId, row.id))
    .orderBy(user.username)
    .limit(200)
}

export function listFollowing(row: UserRow) {
  return db
    .select({
      id: user.id,
      username: user.username,
      displayUsername: user.displayUsername,
      name: user.name,
      image: user.image,
    })
    .from(follow)
    .innerJoin(user, eq(user.id, follow.followingId))
    .where(eq(follow.followerId, row.id))
    .orderBy(user.username)
    .limit(200)
}
