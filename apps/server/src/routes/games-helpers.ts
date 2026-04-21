import { game } from "@workspace/db/schema"

import {
  SteamGridDBError,
  SteamGridDBNotConfiguredError,
} from "../lib/steamgriddb"

export function serialiseGame(row: typeof game.$inferSelect) {
  return {
    id: row.id,
    steamgriddbId: row.steamgriddbId,
    name: row.name,
    slug: row.slug,
    releaseDate: row.releaseDate ? row.releaseDate.toISOString() : null,
    heroUrl: row.heroUrl,
    logoUrl: row.logoUrl,
    iconUrl: row.iconUrl,
  }
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
