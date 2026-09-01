import { createHash } from "node:crypto"
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { t } from "@alloy/contracts/schema"
import { createLogger } from "@alloy/logging"
import { app, net } from "electron"

import { isAllowedAssetSource } from "./asset-cache-policy"
import {
  markHousekeepingPathActive,
  markHousekeepingPathInactive,
} from "./housekeeping/active-paths"
import {
  StrictFiniteNumberSchema,
  StrictStringSchema,
  type UntrustedInput,
} from "./runtime-validation"
import { mainSession } from "./session"

const logger = createLogger("assets")

/**
 * Disk-backed cache for remote images the desktop shell renders repeatedly:
 * game icons, grids/heroes, and other server- or CDN-hosted assets. Entries
 * are served through the `alloy-asset://` protocol so they stay available
 * across restarts and when the network (or the Alloy server) is slow or gone.
 *
 * URL shape: `alloy-asset://remote/<base64url(source URL)>`. The handler accepts
 * only selected-server game assets and fixed SteamGridDB HTTPS hosts. It
 * validates every redirect, bounds the stream, and never forwards cookies.
 */
export const ASSET_PROTOCOL = "alloy-asset"
const ASSET_HOST = "remote"
const FRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ENTRY_BYTES = 10 * 1024 * 1024
const MAX_CACHE_BYTES = 128 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 3

export function assetCacheProtocolScheme(): Electron.CustomScheme {
  return {
    scheme: ASSET_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      stream: true,
    },
  }
}

/**
 * Maps a candidate remote image to its cache URL. The protocol handler applies
 * the authoritative source allowlist before making a request.
 */
export function cachedAssetUrl(url: string | null): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return url
  return `${ASSET_PROTOCOL}://${ASSET_HOST}/${Buffer.from(url, "utf8").toString("base64url")}`
}

let assetProtocolRegistered = false
let selectedServerOrigin: string | null = null

export function selectAssetCacheServer(serverOrigin: string): void {
  selectedServerOrigin = serverOrigin
}

export function clearAssetCacheServer(): void {
  selectedServerOrigin = null
}

export function registerAssetCacheProtocol(): void {
  if (assetProtocolRegistered) return
  assetProtocolRegistered = true

  mainSession().protocol.handle(ASSET_PROTOCOL, async (request) => {
    const sourceUrl = assetUrlFromRequest(request.url)
    if (!sourceUrl) return new Response("Not found", { status: 404 })
    return serveAsset(sourceUrl)
  })
}

interface AssetMeta {
  url: string
  contentType: string
  fetchedAt: number
  lastUsedAt: number
  sizeBytes: number
}

const AssetMetaSchema = t.object({
  url: StrictStringSchema,
  contentType: StrictStringSchema,
  fetchedAt: StrictFiniteNumberSchema,
  lastUsedAt: StrictFiniteNumberSchema,
  sizeBytes: StrictFiniteNumberSchema,
})

const pendingFetches = new Map<string, Promise<Response>>()

async function serveAsset(sourceUrl: string): Promise<Response> {
  const key = assetKey(sourceUrl)
  const cached = readCachedAsset(key)

  if (cached && Date.now() - cached.meta.fetchedAt < FRESH_TTL_MS) {
    touchAssetMeta(key, cached.meta)
    return assetResponse(cached.body, cached.meta.contentType)
  }

  // Concurrent requests for the same asset (e.g. a grid of identical game
  // icons) share one network fetch instead of racing on the cache files.
  const pending = pendingFetches.get(key)
  if (pending) return pending.then((response) => response.clone())

  markHousekeepingPathActive("asset", assetBodyPath(key))
  markHousekeepingPathActive("asset", assetMetaPath(key))
  const task = fetchAndStoreAsset(sourceUrl, key, cached).finally(() => {
    pendingFetches.delete(key)
    markHousekeepingPathInactive("asset", assetBodyPath(key))
    markHousekeepingPathInactive("asset", assetMetaPath(key))
  })
  pendingFetches.set(key, task)
  return task.then((response) => response.clone())
}

async function fetchAndStoreAsset(
  sourceUrl: string,
  key: string,
  stale: { meta: AssetMeta; body: Buffer } | null,
): Promise<Response> {
  try {
    const response = await fetchAllowedAsset(
      sourceUrl,
      AbortSignal.timeout(FETCH_TIMEOUT_MS),
    )
    const contentType = response.headers.get("content-type") ?? ""
    if (!response.ok || !contentType.toLowerCase().startsWith("image/")) {
      throw new Error(
        `Asset fetch failed: ${response.status} ${contentType || "no content type"}`,
      )
    }
    const declaredBytes = Number(response.headers.get("content-length"))
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_ENTRY_BYTES) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error("Asset exceeds byte limit")
    }

    const body = await readBoundedAssetBody(response)
    if (body.byteLength > 0) {
      writeCachedAsset(key, sourceUrl, contentType, body)
    }
    return assetResponse(body, contentType)
  } catch (cause) {
    if (stale) {
      logger.warn("asset refresh failed; serving stale cache entry:", cause)
      touchAssetMeta(key, stale.meta)
      return assetResponse(stale.body, stale.meta.contentType)
    }
    logger.warn("failed to fetch remote asset:", cause)
    return new Response("Bad gateway", { status: 502 })
  }
}

async function fetchAllowedAsset(
  sourceUrl: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<Response> {
  if (!isAllowedAssetSource(sourceUrl, selectedServerOrigin)) {
    throw new Error("Asset source is not allowed")
  }

  const response = await net.fetch(sourceUrl, {
    // Cached assets are public images. Never attach session credentials.
    credentials: "omit",
    redirect: "manual",
    signal,
  })
  if (response.status < 300 || response.status > 399) return response

  const location = response.headers.get("location")
  await response.body?.cancel().catch(() => undefined)
  if (!location || redirects >= MAX_REDIRECTS) {
    throw new Error("Asset redirect was rejected")
  }
  return fetchAllowedAsset(
    new URL(location, sourceUrl).toString(),
    signal,
    redirects + 1,
  )
}

async function readBoundedAssetBody(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Asset response has no body")

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_ENTRY_BYTES) throw new Error("Asset exceeds byte limit")
      chunks.push(value)
    }
  } catch (cause) {
    await reader.cancel().catch(() => undefined)
    throw cause
  }
  return Buffer.concat(chunks, total)
}

function assetResponse(body: Buffer, contentType: string): Response {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "content-type": contentType || "application/octet-stream",
      "cache-control": "public, max-age=3600",
    },
  })
}

function readCachedAsset(
  key: string,
): { meta: AssetMeta; body: Buffer } | null {
  try {
    const meta: unknown = JSON.parse(readFileSync(assetMetaPath(key), "utf8"))
    if (!isAssetMeta(meta)) return null
    const body = readFileSync(assetBodyPath(key))
    return { meta, body }
  } catch {
    return null
  }
}

function writeCachedAsset(
  key: string,
  url: string,
  contentType: string,
  body: Buffer,
): void {
  try {
    mkdirSync(assetCacheFolder(), { recursive: true })
    writeFileSync(assetBodyPath(key), body)
    const meta: AssetMeta = {
      url,
      contentType,
      fetchedAt: Date.now(),
      lastUsedAt: Date.now(),
      sizeBytes: body.byteLength,
    }
    writeFileSync(assetMetaPath(key), JSON.stringify(meta))
    pruneAssetCache()
  } catch (cause) {
    logger.warn("failed to persist cached asset:", cause)
  }
}

/**
 * Records cache hits so pruning can evict least-recently-used entries.
 * Throttled to one write per hour per entry to avoid hammering the disk.
 */
function touchAssetMeta(key: string, meta: AssetMeta): void {
  if (Date.now() - meta.lastUsedAt < 60 * 60 * 1000) return
  try {
    writeFileSync(
      assetMetaPath(key),
      JSON.stringify({ ...meta, lastUsedAt: Date.now() }),
    )
  } catch {
    // Best effort — a missed touch only skews LRU ordering slightly.
  }
}

function pruneAssetCache(): void {
  const folder = assetCacheFolder()
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return
  }

  const entries: Array<{ key: string; meta: AssetMeta }> = []
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    const key = name.slice(0, -".json".length)
    try {
      const meta: unknown = JSON.parse(readFileSync(join(folder, name), "utf8"))
      if (isAssetMeta(meta)) entries.push({ key, meta })
    } catch {
      // Corrupt meta — drop the pair below by treating it as oldest.
      entries.push({
        key,
        meta: {
          url: "",
          contentType: "",
          fetchedAt: 0,
          lastUsedAt: 0,
          sizeBytes: 0,
        },
      })
    }
  }

  let total = entries.reduce((sum, entry) => sum + entry.meta.sizeBytes, 0)
  if (total <= MAX_CACHE_BYTES) return

  entries.sort((a, b) => a.meta.lastUsedAt - b.meta.lastUsedAt)
  for (const entry of entries) {
    if (total <= MAX_CACHE_BYTES) break
    try {
      rmSync(assetBodyPath(entry.key), { force: true })
      rmSync(assetMetaPath(entry.key), { force: true })
      total -= entry.meta.sizeBytes
    } catch {
      // A locked file just stays until the next prune pass.
    }
  }
}

function assetKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 40)
}

function assetCacheFolder(): string {
  return join(app.getPath("userData"), "asset-cache")
}

function assetBodyPath(key: string): string {
  return join(assetCacheFolder(), `${key}.bin`)
}

function assetMetaPath(key: string): string {
  return join(assetCacheFolder(), `${key}.json`)
}

function isAssetMeta(value: UntrustedInput): value is AssetMeta {
  return AssetMetaSchema.safeParse(value).success
}

function assetUrlFromRequest(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== `${ASSET_PROTOCOL}:`) return null
    if (url.hostname !== ASSET_HOST) return null
    const encoded = url.pathname.replace(/^\/+/, "")
    if (!/^[A-Za-z0-9_-]{8,2048}$/.test(encoded)) return null
    const decoded = Buffer.from(encoded, "base64url").toString("utf8")
    const source = new URL(decoded).toString()
    return isAllowedAssetSource(source, selectedServerOrigin) ? source : null
  } catch {
    return null
  }
}
