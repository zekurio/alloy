import type { GameListRow, GameRow, ProfileGameRow } from "@alloy/contracts"
import { IGDBError, IGDBNotConfiguredError } from "@alloy/server/games/igdb"
import { isoDate } from "@alloy/server/runtime/date"
import { errorMessage } from "@alloy/server/runtime/error-message"
import { z } from "zod"

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
  igdbId: z.number().int().positive(),
})

export const LookupBody = z.object({
  names: z
    .array(requiredTrimmedString(120))
    .max(50)
    .transform((names) => [...new Set(names)]),
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

export function serialiseGame(row: GameRow): GameRow {
  return row
}

export function serialiseGameListRow(
  row: GameRow & { clipCount: number },
): GameListRow {
  return {
    ...serialiseGame(row),
    clipCount: row.clipCount,
  }
}

export function serialiseProfileGameRow(
  row: GameRow & { clipCount: number; lastClippedAt: Date | string },
): ProfileGameRow {
  return {
    ...serialiseGameListRow(row),
    lastClippedAt: isoDate(row.lastClippedAt),
  }
}

export function igdbErrorResponse(
  err: unknown,
):
  | { status: 503; error: string }
  | { status: 502; error: string }
  | { status: 500; error: string } {
  if (err instanceof IGDBNotConfiguredError) {
    return { status: 503, error: err.message }
  }
  if (err instanceof IGDBError) {
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
