import type {
  GameAssetRole,
  SteamGridDBAsset,
  SteamGridDBGameDetail,
  SteamGridDBSearchResult,
} from "@alloy/contracts"
import { safeParse, t } from "@alloy/contracts/schema"
import { secretStore } from "@alloy/server/config/secret-store"
import { errorMessage } from "@alloy/server/runtime/error-message"
import type { TSchema } from "typebox"

const STEAMGRIDDB_ORIGIN = "https://www.steamgriddb.com"
const STEAMGRIDDB_API_PATH = "/api/v2"

const HERO_DIMENSIONS = "1920x620,3840x1240"
const GRID_DIMENSIONS = "600x900,342x482,660x930"

// One listing per artwork role. Heroes and grids are filtered to the frames
// Alloy renders so every selectable asset works as page header or box art;
// logos and icons keep their own aspect ratios.
const ASSET_LISTS = {
  hero: { path: "heroes", query: { dimensions: HERO_DIMENSIONS } },
  grid: { path: "grids", query: { dimensions: GRID_DIMENSIONS } },
  logo: { path: "logos", query: {} },
  icon: { path: "icons", query: {} },
} as const satisfies Record<
  GameAssetRole,
  { path: string; query: Record<string, string> }
>

// The deadline covers the body too: a response that stalls after its headers
// must not pin the caller (and whatever in-flight map holds it) forever.
const REQUEST_TIMEOUT_MS = 10_000
// Asset listings for popular games run to a few hundred KB.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
// SteamGridDB rate-limits per key. A library lookup fans out to one search
// per unmatched name, so the whole process shares one small window.
const MAX_CONCURRENT_REQUESTS = 4
const MAX_QUEUED_REQUESTS = 256
// The request deadline starts only once a slot is free, so the wait for one
// is bounded too: a caller at the back of a full queue gives up instead of
// holding its HTTP request (and any in-flight entry) open for minutes.
const QUEUE_WAIT_TIMEOUT_MS = 20_000

// Successful answers, including "nothing found", are reused for a while so a
// name that never matches or an id that does not exist costs one round-trip
// per window instead of one per read. Errors are never cached: the next
// caller retries.
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000
const GAME_CACHE_TTL_MS = 60 * 60 * 1000
const ASSET_CACHE_TTL_MS = 60 * 60 * 1000
const SEARCH_CACHE_MAX_ENTRIES = 1024
const GAME_CACHE_MAX_ENTRIES = 1024
const ASSET_CACHE_MAX_ENTRIES = 2048

export class SteamGridDBError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message)
    this.name = "SteamGridDBError"
  }
}

const SteamGridDbResponse = t.object({
  success: t.boolean(),
  errors: t.array(t.string()).optional(),
  data: t.unknown().optional(),
})
type SteamGridDbEnvelope = t.infer<typeof SteamGridDbResponse>

// Autocomplete row. `release_date` is a Unix timestamp in seconds when
// present; SGDB omits it for some games (mods, unknown releases).
const SearchResultSchema = t.object({
  id: t.number().int(),
  name: t.string(),
  release_date: t.number().int().optional(),
  types: t.array(t.string()).optional(),
  verified: t.boolean().optional(),
})
const SearchResultsSchema = t.array(SearchResultSchema)

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
const AssetListSchema = t.array(AssetSchema)

function getApiKey(): string {
  return secretStore.get("steamgriddbApiKey")
}

/**
 * Answers for one endpoint, keyed by URL. Each entry expires after the
 * endpoint's TTL; the oldest entries go first once the cache is full. Calls
 * for a URL that is still loading share the pending promise.
 */
class EndpointCache<Value> {
  private readonly entries = new Map<
    string,
    { value: Value; expiresAt: number }
  >()
  private readonly pending = new Map<string, Promise<Value>>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  /**
   * The cached value while it is fresh, else a fetched one. `fresh` skips the
   * cached value but still joins a load in flight and stores the result.
   */
  async load(
    key: string,
    fetchValue: () => Promise<Value>,
    { fresh = false }: { fresh?: boolean } = {},
  ): Promise<Value> {
    const entry = fresh ? undefined : this.entries.get(key)
    if (entry) {
      if (entry.expiresAt > Date.now()) {
        // Touch LRU order: delete + re-insert puts it at the tail.
        this.entries.delete(key)
        this.entries.set(key, entry)
        return entry.value
      }
      this.entries.delete(key)
    }

    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight

    const load = fetchValue()
      .then((value) => {
        this.store(key, value)
        return value
      })
      .finally(() => {
        this.pending.delete(key)
      })
    this.pending.set(key, load)
    return load
  }

  private store(key: string, value: Value) {
    this.entries.delete(key)
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}

const searchCache = new EndpointCache<SteamGridDBSearchResult[]>(
  SEARCH_CACHE_TTL_MS,
  SEARCH_CACHE_MAX_ENTRIES,
)
const gameCache = new EndpointCache<SteamGridDBGameDetail | null>(
  GAME_CACHE_TTL_MS,
  GAME_CACHE_MAX_ENTRIES,
)
const assetCache = new EndpointCache<SteamGridDBAsset[]>(
  ASSET_CACHE_TTL_MS,
  ASSET_CACHE_MAX_ENTRIES,
)

let activeRequests = 0
const waitingRequests: Array<() => void> = []

function waitForRequestSlot(): Promise<void> {
  return new Promise((resolve, reject) => {
    const grant = () => {
      clearTimeout(timer)
      resolve()
    }
    // A waiter that times out leaves the queue, so no slot is handed to it.
    const timer = setTimeout(() => {
      const index = waitingRequests.indexOf(grant)
      if (index !== -1) waitingRequests.splice(index, 1)
      reject(new SteamGridDBError("SteamGridDB request queue timed out", null))
    }, QUEUE_WAIT_TIMEOUT_MS)
    waitingRequests.push(grant)
  })
}

async function withRequestSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    if (waitingRequests.length >= MAX_QUEUED_REQUESTS) {
      throw new SteamGridDBError("SteamGridDB request queue is full", null)
    }
    // A finishing request hands its slot straight to the first waiter.
    await waitForRequestSlot()
  } else {
    activeRequests += 1
  }
  try {
    return await run()
  } finally {
    const next = waitingRequests.shift()
    if (next) next()
    else activeRequests -= 1
  }
}

function isTimeoutError(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    (cause.name === "TimeoutError" || cause.name === "AbortError")
  )
}

async function readBoundedBody(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return res.text()

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        throw new SteamGridDBError(
          "SteamGridDB response exceeds the size limit",
          res.status,
        )
      }
      chunks.push(value)
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined)
    throw err
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function readEnvelope(res: Response): Promise<SteamGridDbEnvelope> {
  let body: string
  try {
    body = await readBoundedBody(res)
  } catch (err) {
    if (err instanceof SteamGridDBError) throw err
    if (isTimeoutError(err)) {
      throw new SteamGridDBError("SteamGridDB response timed out", res.status)
    }
    throw new SteamGridDBError(
      errorMessage(err, "SteamGridDB response failed"),
      res.status,
    )
  }
  let json: unknown
  try {
    json = JSON.parse(body)
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
  return parsed.data
}

async function fetchEndpoint(url: URL): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new SteamGridDBError("SteamGridDB request timed out", null)
    }
    throw new SteamGridDBError(
      errorMessage(err, "SteamGridDB request failed"),
      null,
    )
  }
}

function endpointUrl(path: string, query?: Record<string, string>): URL {
  const url = new URL(`${STEAMGRIDDB_API_PATH}${path}`, STEAMGRIDDB_ORIGIN)
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  }
  return url
}

/**
 * One SteamGridDB GET, run inside the shared concurrency window. A 404 and a
 * success envelope without `data` both mean "nothing there" and return null.
 */
async function requestOnce<DataSchema extends TSchema>(
  url: URL,
  dataSchema: DataSchema,
): Promise<t.infer<DataSchema> | null> {
  const res = await fetchEndpoint(url)
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined)
    return null
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    throw new SteamGridDBError(
      `SteamGridDB responded ${res.status} ${res.statusText}`,
      res.status,
    )
  }

  const envelope = await readEnvelope(res)
  if (!envelope.success) {
    const msg = envelope.errors?.join(", ") ?? "unknown error"
    throw new SteamGridDBError(`SteamGridDB error: ${msg}`, res.status)
  }
  if (envelope.data === undefined) return null
  const data = safeParse(dataSchema, envelope.data)
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
  const url = endpointUrl(`/search/autocomplete/${encodeURIComponent(query)}`)
  return searchCache.load(url.toString(), async () => {
    const data = await withRequestSlot(() =>
      requestOnce(url, SearchResultsSchema),
    )
    return data ?? []
  })
}

export async function getGameById(
  steamgriddbId: number,
): Promise<SteamGridDBGameDetail | null> {
  const url = endpointUrl(`/games/id/${steamgriddbId}`)
  return gameCache.load(url.toString(), () =>
    withRequestSlot(() => requestOnce(url, GameDetailSchema)),
  )
}

/**
 * Every asset SteamGridDB lists for one artwork role, in upstream order. Lazy
 * game ingestion caches the first entry; the admin artwork picker offers the
 * whole list and asks for a `fresh` one so newly uploaded art shows up at
 * once. NSFW and humor assets are excluded explicitly so what the picker shows
 * does not depend on upstream defaults.
 */
export async function listGameAssets(
  steamgriddbId: number,
  role: GameAssetRole,
  options?: { fresh?: boolean },
): Promise<SteamGridDBAsset[]> {
  const request = ASSET_LISTS[role]
  const url = endpointUrl(`/${request.path}/game/${steamgriddbId}`, {
    ...request.query,
    nsfw: "false",
    humor: "false",
  })
  return assetCache.load(
    url.toString(),
    async () => {
      const data = await withRequestSlot(() =>
        requestOnce(url, AssetListSchema),
      )
      return data ?? []
    },
    options,
  )
}

/**
 * The first asset for one role, telling "SteamGridDB has none" apart from
 * "the request failed". Callers that persist artwork keep what they have on
 * `failed` instead of clearing it.
 */
export type GameAssetFetch =
  | { kind: "asset"; asset: SteamGridDBAsset }
  | { kind: "absent" }
  | { kind: "failed"; error: unknown }

export async function fetchFirstGameAsset(
  steamgriddbId: number,
  role: GameAssetRole,
): Promise<GameAssetFetch> {
  try {
    const asset = (await listGameAssets(steamgriddbId, role))[0]
    return asset ? { kind: "asset", asset } : { kind: "absent" }
  } catch (error) {
    return { kind: "failed", error }
  }
}
