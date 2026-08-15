import type {
  SteamGridDBAsset,
  SteamGridDBGameDetail,
  SteamGridDBSearchResult,
} from "@alloy/contracts"
import { safeParse, t } from "@alloy/contracts/schema"
import { secretStore } from "@alloy/server/config/secret-store"
import { errorMessage, isAbortError } from "@alloy/server/runtime/error-message"
import type { TSchema } from "typebox"

const STEAMGRIDDB_ORIGIN = "https://www.steamgriddb.com"
const STEAMGRIDDB_API_PATH = "/api/v2"

const HERO_DIMENSIONS = "1920x620,3840x1240"
const GRID_DIMENSIONS = "600x900,342x482,660x930"

const REQUEST_TIMEOUT_MS = 10_000

export class SteamGridDBError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message)
    this.name = "SteamGridDBError"
  }
}

export class SteamGridDBNotConfiguredError extends SteamGridDBError {
  constructor() {
    super("SteamGridDB API key is not configured.", null)
    this.name = "SteamGridDBNotConfiguredError"
  }
}

const SteamGridDbEnvelope = {
  success: t.boolean(),
  errors: t.array(t.string()).optional(),
}
const SteamGridDbResponse = t.object({
  ...SteamGridDbEnvelope,
  data: t.unknown().optional(),
})

// Autocomplete row. `release_date` is a Unix timestamp in seconds when
// present; SGDB omits it for some games (mods, unknown releases).
const SearchResultSchema = t.object({
  id: t.number().int(),
  name: t.string(),
  release_date: t.number().int().optional(),
  types: t.array(t.string()).optional(),
  verified: t.boolean().optional(),
})

const GameDetailSchema = t.object({
  id: t.number().int(),
  name: t.string(),
  release_date: t.number().int().optional().nullable(),
  types: t.array(t.string()).optional(),
  verified: t.boolean().optional(),
})

const AssetSchema = t.object({
  id: t.number().int(),
  url: t.string().url(),
  thumb: t.string().url().optional(),
  width: t.number().int().optional(),
  height: t.number().int().optional(),
  style: t.string().optional(),
  nsfw: t.boolean().optional(),
  humor: t.boolean().optional(),
})

function getApiKey(): string {
  const key = secretStore.get("steamgriddbApiKey")
  if (!key || key.length === 0) {
    throw new SteamGridDBNotConfiguredError()
  }
  return key
}

async function sgdbFetch<DataSchema extends TSchema>(
  path: string,
  dataSchema: DataSchema,
  query?: Record<string, string>,
): Promise<t.infer<DataSchema> | null> {
  const apiKey = getApiKey()
  const url = new URL(`${STEAMGRIDDB_API_PATH}${path}`, STEAMGRIDDB_ORIGIN)
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
  } catch (err) {
    if (isAbortError(err)) {
      throw new SteamGridDBError("SteamGridDB request timed out", null)
    }
    throw new SteamGridDBError(
      errorMessage(err, "SteamGridDB request failed"),
      null,
    )
  } finally {
    clearTimeout(timeout)
  }

  if (res.status === 404) return null
  if (!res.ok) {
    throw new SteamGridDBError(
      `SteamGridDB responded ${res.status} ${res.statusText}`,
      res.status,
    )
  }

  let json: unknown
  try {
    json = await res.json()
  } catch (err) {
    throw new SteamGridDBError(
      errorMessage(err, "SteamGridDB returned invalid JSON"),
      res.status,
    )
  }
  const parsed = safeParse(SteamGridDbResponse, json)
  if (!parsed.success) {
    throw new SteamGridDBError(
      `Unexpected SteamGridDB response shape: ${parsed.error.message}`,
      res.status,
    )
  }
  if (!parsed.data.success) {
    const msg = parsed.data.errors?.join(", ") ?? "unknown error"
    throw new SteamGridDBError(`SteamGridDB error: ${msg}`, res.status)
  }
  // SGDB returns `success: true` with no `data` for some empty lookups;
  // we never treat that as an error, the caller normalises.
  if (parsed.data.data === undefined) return null
  const data = safeParse(dataSchema, parsed.data.data)
  if (!data.success) {
    throw new SteamGridDBError(
      `Unexpected SteamGridDB response data: ${data.error.message}`,
      res.status,
    )
  }
  return data.data
}

export async function searchSteamGridDBGames(
  query: string,
): Promise<SteamGridDBSearchResult[]> {
  const data = await sgdbFetch(
    `/search/autocomplete/${encodeURIComponent(query)}`,
    t.array(SearchResultSchema),
  )
  return data ?? []
}

export async function getGameById(
  steamgriddbId: number,
): Promise<SteamGridDBGameDetail | null> {
  return await sgdbFetch(`/games/id/${steamgriddbId}`, GameDetailSchema)
}

export async function getFirstHero(
  steamgriddbId: number,
): Promise<SteamGridDBAsset | null> {
  const data = await sgdbFetch(
    `/heroes/game/${steamgriddbId}`,
    t.array(AssetSchema),
    { dimensions: HERO_DIMENSIONS },
  )
  return data?.[0] ?? null
}

export async function getFirstGrid(
  steamgriddbId: number,
): Promise<SteamGridDBAsset | null> {
  const data = await sgdbFetch(
    `/grids/game/${steamgriddbId}`,
    t.array(AssetSchema),
    { dimensions: GRID_DIMENSIONS },
  )
  return data?.[0] ?? null
}

export async function getFirstLogo(
  steamgriddbId: number,
): Promise<SteamGridDBAsset | null> {
  const data = await sgdbFetch(
    `/logos/game/${steamgriddbId}`,
    t.array(AssetSchema),
  )
  return data?.[0] ?? null
}

export async function getFirstIcon(
  steamgriddbId: number,
): Promise<SteamGridDBAsset | null> {
  const data = await sgdbFetch(
    `/icons/game/${steamgriddbId}`,
    t.array(AssetSchema),
  )
  return data?.[0] ?? null
}

export function isConfigured(): boolean {
  return secretStore.get("steamgriddbApiKey").length > 0
}
