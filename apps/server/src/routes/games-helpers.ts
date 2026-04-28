import type { GameRow } from "@workspace/contracts"
import { game } from "@workspace/db/schema"
import { z } from "zod"

import {
  SteamGridDBError,
  SteamGridDBNotConfiguredError,
} from "../games/steamgriddb"

export const SlugParam = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
})

export const SearchQuery = z.object({
  q: z.string().min(1).max(120),
})

export const ResolveBody = z.object({
  steamgriddbId: z.number().int().positive(),
})

export const ClipsQuery = z.object({
  sort: z.enum(["top", "recent"]).default("recent"),
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.iso.datetime().optional(),
})

export const TopQuery = z.object({
  limit: z.coerce.number().int().positive().max(20).default(5),
})

export const GamesListQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

export function serialiseGame(row: typeof game.$inferSelect) {
  return {
    id: row.id,
    steamgriddbId: row.steamgriddbId,
    name: row.name,
    slug: row.slug,
    releaseDate: row.releaseDate ? row.releaseDate.toISOString() : null,
    heroUrl: row.heroUrl,
    gridUrl: row.gridUrl,
    logoUrl: row.logoUrl,
    iconUrl: row.iconUrl,
  } satisfies GameRow
}

export function sgdbErrorResponse(
  err: unknown
):
  | { status: 503; error: string }
  | { status: 502; error: string }
  | { status: 500; error: string } {
  if (err instanceof SteamGridDBNotConfiguredError) {
    return { status: 503, error: err.message }
  }
  if (err instanceof SteamGridDBError) {
    return { status: 502, error: err.message }
  }
  return {
    status: 500,
    error: err instanceof Error ? err.message : "Unknown error",
  }
}
