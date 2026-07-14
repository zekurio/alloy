import type { GameSource, IsoDateString } from "./shared"

export const GAME_ASSET_PATH_PREFIX = "/api/assets/games/"

export function gameAssetImagePath(key: string, updatedAt: Date): string {
  const version = updatedAt.getTime().toString(36)
  return `${GAME_ASSET_PATH_PREFIX}${key}?v=${version}`
}

export interface ClipGameRef {
  id: string
  steamgriddbId: number | null
  source: GameSource
  slug: string
  name: string
  releaseDate: IsoDateString | null
  heroUrl: string | null
  heroBlurHash: string | null
  gridUrl: string | null
  gridBlurHash: string | null
  logoUrl: string | null
  iconUrl: string | null
}

export interface FeedChipGame {
  id: string
  steamgriddbId: number | null
  slug: string
  name: string
  iconUrl: string | null
  logoUrl: string | null
  interaction: number
  clipCount: number
}

export interface FeedChipsResponse {
  games: FeedChipGame[]
}

export interface TagGamesResponse {
  clipCount: number
  games: GameListRow[]
}

export interface SteamGridDBSearchResult {
  id: number
  name: string
  release_date?: number | null
  types?: string[]
  verified?: boolean
  heroUrl?: string | null
  gridUrl?: string | null
  iconUrl?: string | null
  logoUrl?: string | null
}

export interface SteamGridDBGameDetail {
  id: number
  name: string
  release_date?: number | null
  types?: string[]
  verified?: boolean
}

export interface SteamGridDBAsset {
  id: number
  url: string
  thumb?: string
  width?: number
  height?: number
  style?: string
  nsfw?: boolean
  humor?: boolean
}

export interface GameRow {
  id: string
  steamgriddbId: number | null
  source: GameSource
  name: string
  slug: string
  releaseDate: IsoDateString | null
  heroUrl: string | null
  heroBlurHash: string | null
  gridUrl: string | null
  gridBlurHash: string | null
  logoUrl: string | null
  iconUrl: string | null
}

export interface GameListRow extends GameRow {
  clipCount: number
}

export interface ProfileGameRow extends GameListRow {
  lastClippedAt: IsoDateString
}

export interface GameDetail extends GameRow {
  viewer: { isFollowing: boolean } | null
  favouritesCount: number
  /** Ready, public clips attributed to this game by enabled users. */
  clipCount: number
}

export const GAME_ASSET_ROLES = ["hero", "grid", "logo", "icon"] as const
export type GameAssetRole = (typeof GAME_ASSET_ROLES)[number]

export interface AdminGameRow extends GameRow {
  clipCount: number
}

export interface AdminCreateGameInput {
  name: string
  releaseDate?: string | null
  /** Artwork uploaded alongside the metadata in one multipart request. */
  assets?: Partial<Record<GameAssetRole, File>>
}

export interface AdminUpdateGameInput {
  name?: string
  slug?: string
  releaseDate?: string | null
  heroUrl?: string | null
  gridUrl?: string | null
  logoUrl?: string | null
  iconUrl?: string | null
}

export type GameNameLookupReason =
  | "indexed-exact-name"
  | "indexed-normalized-name"
  | "steamgriddb-exact-name"
  | "steamgriddb-normalized-name"
  | "no-match"
  | "ambiguous"

export interface GameNameLookupResult {
  name: string
  game: GameRow | null
  confidence: number
  reason: GameNameLookupReason
}

export interface GameNameLookupResponse {
  results: GameNameLookupResult[]
}

export interface SteamGridDBStatus {
  steamgriddbConfigured: boolean
}
