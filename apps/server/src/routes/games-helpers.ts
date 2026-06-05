import type { GameListRow, GameRow, ProfileGameRow } from "@workspace/contracts"
import { game } from "@workspace/db/schema"
import { z } from "zod"

import {
  SteamGridDBError,
  SteamGridDBNotConfiguredError,
} from "../games/steamgriddb"
import { isoDate, nullableIsoDate } from "../runtime/date"
import { errorMessage } from "../runtime/error-message"
import {
  limitQueryParam,
  offsetQueryParam,
  requiredTrimmedString,
} from "./validation"

export const SlugParam = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
})

export const SearchQuery = z.object({
  q: requiredTrimmedString(120),
})

export const ResolveBody = z.object({
  steamgriddbId: z.number().int().positive(),
})

export const ClipsQuery = z.object({
  sort: z.enum(["top", "recent"]).default("recent"),
  limit: limitQueryParam(100, 50),
  cursor: z.string().optional(),
})

export const TopQuery = z.object({
  limit: limitQueryParam(20, 5),
})

export const GamesListQuery = z.object({
  limit: limitQueryParam(100, 100),
  offset: offsetQueryParam(),
})

type GameRowFields = Pick<
  typeof game.$inferSelect,
  | "id"
  | "steamgriddbId"
  | "name"
  | "slug"
  | "releaseDate"
  | "heroUrl"
  | "gridUrl"
  | "logoUrl"
  | "iconUrl"
>

export function serialiseGame(row: GameRowFields): GameRow {
  return {
    id: row.id,
    steamgriddbId: row.steamgriddbId,
    name: row.name,
    slug: row.slug,
    releaseDate: nullableIsoDate(row.releaseDate),
    heroUrl: row.heroUrl,
    gridUrl: row.gridUrl,
    logoUrl: row.logoUrl,
    iconUrl: row.iconUrl,
  }
}

export function serialiseGameListRow(
  row: GameRowFields & { clipCount: number },
): GameListRow {
  return {
    ...serialiseGame(row),
    clipCount: row.clipCount,
  }
}

export function serialiseProfileGameRow(
  row: GameRowFields & { clipCount: number; lastClippedAt: Date | string },
): ProfileGameRow {
  return {
    ...serialiseGameListRow(row),
    lastClippedAt: isoDate(row.lastClippedAt),
  }
}

export function sgdbErrorResponse(
  err: unknown,
):
  | { status: 503; error: string }
  | { status: 502; error: string }
  | { status: 500; error: string } {
  if (err instanceof SteamGridDBNotConfiguredError) {
    return { status: 503, error: err.message }
  }
  if (err instanceof SteamGridDBError) {
    const status =
      err.status === null ||
      err.status >= 500 ||
      err.status === 401 ||
      err.status === 403
        ? 503
        : 502
    return { status, error: err.message }
  }
  return {
    status: 500,
    error: errorMessage(err, "Unknown error"),
  }
}
