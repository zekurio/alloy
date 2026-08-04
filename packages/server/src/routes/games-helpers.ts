import type { GameRow, ProfileGameRow } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import {
  SteamGridDBError,
  SteamGridDBNotConfiguredError,
} from "@alloy/server/games/steamgriddb"
import { isoDate } from "@alloy/server/runtime/date"
import { errorMessage } from "@alloy/server/runtime/error-message"

import {
  limitQueryParam,
  offsetQueryParam,
  requiredTrimmedString,
} from "./validation"

export const SlugParam = t.object({
  slug: t
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
})

export const SearchQuery = t.object({
  q: requiredTrimmedString(120),
})

export const ResolveBody = t.object({
  steamgriddbId: t.number().int().positive(),
})

export const LookupBody = t.object({
  names: t
    .array(requiredTrimmedString(120))
    .max(50)
    .transform((names) => [...new Set(names)]),
})

export const GamesListQuery = t.object({
  limit: limitQueryParam(100, 100),
  offset: offsetQueryParam(),
})

export function serialiseProfileGameRow(
  row: GameRow & { clipCount: number; lastClippedAt: Date | string },
): ProfileGameRow {
  return {
    ...row,
    lastClippedAt: isoDate(row.lastClippedAt),
  }
}

export function steamgriddbErrorResponse(
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
