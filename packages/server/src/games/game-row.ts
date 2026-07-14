import {
  normalizeBlurHash,
  type GameRow,
  type GameSource,
} from "@alloy/contracts"
import { game } from "@alloy/db/schema"
import { nullableIsoDate } from "@alloy/server/runtime/date"

export const gameSelectShape = {
  id: game.id,
  steamgriddbId: game.steamgriddb_id,
  source: game.source,
  name: game.name,
  slug: game.slug,
  releaseDate: game.release_date,
  heroUrl: game.hero_url,
  heroBlurHash: game.hero_blur_hash,
  gridUrl: game.grid_url,
  gridBlurHash: game.grid_blur_hash,
  logoUrl: game.logo_url,
  iconUrl: game.icon_url,
} as const

export type GameMetadataRow = {
  id: string
  steamgriddbId: number | null
  source: GameSource
  name: string
  slug: string
  releaseDate: Date | string | null
  heroUrl: string | null
  heroBlurHash: string | null
  gridUrl: string | null
  gridBlurHash: string | null
  logoUrl: string | null
  iconUrl: string | null
}

export function serialiseGameRow(row: GameMetadataRow): GameRow {
  return {
    id: row.id,
    steamgriddbId: row.steamgriddbId,
    source: row.source,
    name: row.name,
    slug: row.slug,
    releaseDate: nullableIsoDate(row.releaseDate),
    heroUrl: row.heroUrl,
    heroBlurHash: normalizeBlurHash(row.heroBlurHash),
    gridUrl: row.gridUrl,
    gridBlurHash: normalizeBlurHash(row.gridBlurHash),
    logoUrl: row.logoUrl,
    iconUrl: row.iconUrl,
  }
}
