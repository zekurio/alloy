import type {
  GameRow,
  IGDBAsset,
  IGDBGameDetail,
  IGDBSearchResult,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { secretStore } from "@alloy/server/config/secret-store"
import { imageBlurHash } from "@alloy/server/media/blurhash"
import { errorMessage, isAbortError } from "@alloy/server/runtime/error-message"
import { z } from "zod"

import { gameSlugWithId } from "./slug"

const logger = createLogger("igdb")

const IGDB_ORIGIN = "https://api.igdb.com"
const IGDB_API_PATH = "/v4"
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token"

const REQUEST_TIMEOUT_MS = 10_000
const TOKEN_REFRESH_SKEW_MS = 60_000

type TokenCache = {
  clientId: string
  clientSecret: string
  accessToken: string
  expiresAt: number
}

let tokenCache: TokenCache | null = null

export class IGDBError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message)
    this.name = "IGDBError"
  }
}

export class IGDBNotConfiguredError extends IGDBError {
  constructor() {
    super("IGDB client credentials are not configured.", null)
    this.name = "IGDBNotConfiguredError"
  }
}

const TokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
})

const ImageSchema: z.ZodType<IGDBAsset> = z.object({
  id: z.number().int().optional(),
  image_id: z.string().min(1),
  url: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
})

const AlternativeNameSchema = z.object({
  name: z.string(),
})

const GameSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  first_release_date: z.number().int().optional().nullable(),
  summary: z.string().optional().nullable(),
  cover: ImageSchema.optional().nullable(),
  artworks: z.array(ImageSchema).optional(),
  screenshots: z.array(ImageSchema).optional(),
  alternative_names: z.array(AlternativeNameSchema).optional(),
  total_rating: z.number().optional().nullable(),
  total_rating_count: z.number().int().optional().nullable(),
})

type IGDBGame = z.infer<typeof GameSchema>

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = secretStore.get("igdbClientId")
  const clientSecret = secretStore.get("igdbClientSecret")
  if (!clientId || !clientSecret) throw new IGDBNotConfiguredError()
  return { clientId, clientSecret }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (isAbortError(err)) throw new IGDBError(`${label} timed out`, null)
    throw new IGDBError(errorMessage(err, `${label} failed`), null)
  } finally {
    clearTimeout(timeout)
  }
}

async function readJson(res: Response, label: string): Promise<unknown> {
  try {
    return await res.json()
  } catch (err) {
    throw new IGDBError(
      errorMessage(err, `${label} returned invalid JSON`),
      res.status,
    )
  }
}

async function accessToken(): Promise<{ clientId: string; token: string }> {
  const { clientId, clientSecret } = credentials()
  if (
    tokenCache &&
    tokenCache.clientId === clientId &&
    tokenCache.clientSecret === clientSecret &&
    tokenCache.expiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()
  ) {
    return { clientId, token: tokenCache.accessToken }
  }

  const url = new URL(TWITCH_TOKEN_URL)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("client_secret", clientSecret)
  url.searchParams.set("grant_type", "client_credentials")

  const res = await fetchWithTimeout(
    url.toString(),
    { method: "POST" },
    "Twitch OAuth token request",
  )
  if (!res.ok) {
    throw new IGDBError(
      `Twitch OAuth responded ${res.status} ${res.statusText}`,
      res.status,
    )
  }

  const parsed = TokenSchema.safeParse(await readJson(res, "Twitch OAuth"))
  if (!parsed.success) {
    throw new IGDBError(
      `Unexpected Twitch OAuth response shape: ${parsed.error.message}`,
      res.status,
    )
  }

  tokenCache = {
    clientId,
    clientSecret,
    accessToken: parsed.data.access_token,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
  }

  return { clientId, token: parsed.data.access_token }
}

async function igdbFetch<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  body: string,
): Promise<T> {
  const auth = await accessToken()
  const url = new URL(`${IGDB_API_PATH}/${endpoint}`, IGDB_ORIGIN)
  const res = await fetchWithTimeout(
    url.toString(),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${auth.token}`,
        "Client-ID": auth.clientId,
      },
      body,
    },
    `IGDB ${endpoint} request`,
  )

  if (!res.ok) {
    throw new IGDBError(
      `IGDB responded ${res.status} ${res.statusText}`,
      res.status,
    )
  }

  const parsed = schema.safeParse(await readJson(res, `IGDB ${endpoint}`))
  if (!parsed.success) {
    throw new IGDBError(
      `Unexpected IGDB response shape: ${parsed.error.message}`,
      res.status,
    )
  }
  return parsed.data
}

function apicalypseString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[™®©]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
}

function searchResultScore(result: IGDBGame, normalizedQuery: string): number {
  const normalizedName = normalizeSearchText(result.name)
  const aliases =
    result.alternative_names?.map((alias) => normalizeSearchText(alias.name)) ??
    []

  let score = 0
  if (normalizedName === normalizedQuery) score += 900
  else if (normalizedName.startsWith(normalizedQuery)) score += 550
  else if (normalizedName.includes(normalizedQuery)) score += 250

  if (aliases.some((alias) => alias === normalizedQuery)) score += 700
  if (aliases.some((alias) => alias.startsWith(normalizedQuery))) score += 350
  if (result.total_rating_count)
    score += Math.min(result.total_rating_count, 100)
  if (result.cover) score += 40
  if (result.first_release_date) score += 20

  return score
}

function rankSearchResults(results: IGDBGame[], query: string): IGDBGame[] {
  const normalizedQuery = normalizeSearchText(query)
  if (normalizedQuery.length === 0) return results

  return results
    .map((result, index) => ({
      index,
      result,
      score: searchResultScore(result, normalizedQuery),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ result }) => result)
}

function imageUrl(
  image: IGDBAsset | null | undefined,
  size: string,
): string | null {
  if (!image?.image_id) return null
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${image.image_id}.jpg`
}

function firstHeroImage(game: IGDBGame): IGDBAsset | null {
  return game.artworks?.[0] ?? game.screenshots?.[0] ?? null
}

function toSearchResult(game: IGDBGame): IGDBSearchResult {
  return {
    id: game.id,
    name: game.name,
    release_date: game.first_release_date ?? null,
    heroUrl: imageUrl(firstHeroImage(game), "1080p"),
    gridUrl: imageUrl(game.cover, "cover_big"),
    iconUrl: imageUrl(game.cover, "thumb"),
    logoUrl: null,
  }
}

function toGameDetail(game: IGDBGame): IGDBGameDetail {
  return {
    id: game.id,
    name: game.name,
    release_date: game.first_release_date ?? null,
    summary: game.summary ?? null,
  }
}

const GAME_FIELDS = [
  "id",
  "name",
  "first_release_date",
  "summary",
  "cover.image_id",
  "cover.width",
  "cover.height",
  "artworks.image_id",
  "artworks.width",
  "artworks.height",
  "screenshots.image_id",
  "screenshots.width",
  "screenshots.height",
  "alternative_names.name",
  "total_rating",
  "total_rating_count",
].join(",")

export async function searchGames(query: string): Promise<IGDBSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const games = await igdbFetch(
    "games",
    z.array(GameSchema),
    [
      `fields ${GAME_FIELDS};`,
      `search ${apicalypseString(trimmed)};`,
      "where version_parent = null;",
      "limit 25;",
    ].join(" "),
  )

  return rankSearchResults(games, trimmed).map(toSearchResult)
}

export async function gameRowFromSearchResult(
  result: IGDBSearchResult,
): Promise<GameRow> {
  return {
    id: result.id,
    igdbId: result.id,
    name: result.name,
    slug: gameSlugWithId(result.name, result.id),
    releaseDate:
      typeof result.release_date === "number"
        ? new Date(result.release_date * 1000).toISOString()
        : null,
    heroUrl: result.heroUrl ?? null,
    heroBlurHash: null,
    gridUrl: result.gridUrl ?? null,
    gridBlurHash: null,
    logoUrl: null,
    iconUrl: result.iconUrl ?? null,
  }
}

export async function getGameById(
  igdbId: number,
): Promise<IGDBGameDetail | null> {
  const [game] = await igdbFetch(
    "games",
    z.array(GameSchema),
    [`fields ${GAME_FIELDS};`, `where id = ${igdbId};`, "limit 1;"].join(" "),
  )
  return game ? toGameDetail(game) : null
}

export async function getGameAssets(igdbId: number): Promise<{
  heroUrl: string | null
  heroBlurHash: string | null
  gridUrl: string | null
  gridBlurHash: string | null
  logoUrl: string | null
  iconUrl: string | null
}> {
  const [game] = await igdbFetch(
    "games",
    z.array(GameSchema),
    [`fields ${GAME_FIELDS};`, `where id = ${igdbId};`, "limit 1;"].join(" "),
  )
  const heroUrl = game ? imageUrl(firstHeroImage(game), "1080p") : null
  const gridUrl = game ? imageUrl(game.cover, "cover_big") : null
  const [heroBlurHash, gridBlurHash] = await Promise.all([
    computeGameAssetBlurHash("hero", igdbId, heroUrl),
    computeGameAssetBlurHash("grid", igdbId, gridUrl),
  ])

  return {
    heroUrl,
    heroBlurHash,
    gridUrl,
    gridBlurHash,
    logoUrl: null,
    iconUrl: game ? imageUrl(game.cover, "thumb") : null,
  }
}

async function computeGameAssetBlurHash(
  label: "hero" | "grid",
  igdbId: number,
  url: string | null,
): Promise<string | null> {
  if (!url) return null
  try {
    return await imageBlurHash({
      source: url,
      label: `IGDB ${label} blurhash`,
    })
  } catch (err) {
    logger.warn(`failed to compute ${label} blurhash for ${igdbId}:`, err)
    return null
  }
}

export function isConfigured(): boolean {
  return (
    secretStore.get("igdbClientId").length > 0 &&
    secretStore.get("igdbClientSecret").length > 0
  )
}
