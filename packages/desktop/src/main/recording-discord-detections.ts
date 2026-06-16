import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"

import { createLogger } from "@alloy/logging"
import { app, net } from "electron"

const logger = createLogger("recording")

const DISCORD_DETECTABLE_URL =
  "https://discord.com/api/v9/applications/detectable"
const CACHE_FILE_NAME = "discord-detections.v1.json"
const CACHE_SCHEMA_VERSION = 1
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const REFRESH_CHECK_INTERVAL_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 15_000

interface DiscordDetectionCache {
  schemaVersion: typeof CACHE_SCHEMA_VERSION
  source: "discord-detectable"
  sourceUrl: string
  fetchedAt: string | null
  games: DiscordDetectionGame[]
  executables: Record<string, DiscordExecutableRule[]>
}

interface DiscordDetectionGame {
  id: string
  name: string
  aliases: string[]
  iconHash: string | null
}

interface DiscordExecutableRule {
  gameId: string
  isLauncher: boolean
  score: number
}

let refreshTimer: ReturnType<typeof setInterval> | null = null

export function recordingDiscordDetectionsCachePath(): string {
  return join(app.getPath("userData"), "recording", CACHE_FILE_NAME)
}

export function ensureRecordingDiscordDetectionsCache(): string | null {
  const cachePath = recordingDiscordDetectionsCachePath()
  try {
    mkdirSync(dirname(cachePath), { recursive: true })
    if (!existsSync(cachePath)) {
      writeDetectionCache(cachePath, emptyDetectionCache())
    }
    return cachePath
  } catch (cause) {
    logger.warn("failed to prepare Discord detection cache:", cause)
    return null
  }
}

export function startRecordingDiscordDetectionsRefresh(): void {
  if (process.platform !== "win32") return
  if (refreshTimer) return

  void refreshRecordingDiscordDetections()
  refreshTimer = setInterval(() => {
    void refreshRecordingDiscordDetections()
  }, REFRESH_CHECK_INTERVAL_MS)
  refreshTimer.unref?.()
}

async function refreshRecordingDiscordDetections(): Promise<void> {
  const cachePath = ensureRecordingDiscordDetectionsCache()
  if (!cachePath || cacheIsFresh(cachePath)) return

  try {
    const cache = await fetchDiscordDetections()
    writeDetectionCache(cachePath, cache)
    logger.info(
      `refreshed Discord detections: ${cache.games.length} games, ${Object.keys(cache.executables).length} executable keys`,
    )
  } catch (cause) {
    logger.warn("failed to refresh Discord detections:", cause)
  }
}

async function fetchDiscordDetections(): Promise<DiscordDetectionCache> {
  const response = await net.fetch(DISCORD_DETECTABLE_URL, {
    credentials: "omit",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `Discord detectable games request failed: ${response.status} ${response.statusText}`,
    )
  }

  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) {
    throw new Error("Discord detectable games response was not an array")
  }

  return trimDiscordDetections(payload)
}

function trimDiscordDetections(payload: unknown[]): DiscordDetectionCache {
  const games: DiscordDetectionGame[] = []
  const executables = new Map<string, DiscordExecutableRule[]>()

  for (const raw of payload) {
    const row = recordValue(raw)
    if (!row) continue

    const id = stringValue(row.id)
    const name = stringValue(row.name)
    if (!id || !name) continue

    let matchedExecutable = false
    for (const rawExecutable of arrayValue(row.executables)) {
      const executable = recordValue(rawExecutable)
      if (!executable || stringValue(executable.os) !== "win32") continue

      const key = executableKey(stringValue(executable.name))
      if (!key) continue

      matchedExecutable = true
      const isLauncher = executable.is_launcher === true
      const matches = executables.get(key) ?? []
      matches.push({
        gameId: id,
        isLauncher,
        score: isLauncher ? 82 : 112,
      })
      executables.set(key, matches)
    }

    if (!matchedExecutable) continue

    const iconHash = stringValue(row.icon_hash)
    games.push({
      id,
      name,
      aliases: arrayStrings(row.aliases),
      iconHash: iconHash || null,
    })
  }

  games.sort((left, right) => left.name.localeCompare(right.name))

  const executableIndex: Record<string, DiscordExecutableRule[]> = {}
  for (const [key, matches] of [...executables.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    executableIndex[key] = uniqueExecutableRules(matches)
  }

  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    source: "discord-detectable",
    sourceUrl: DISCORD_DETECTABLE_URL,
    fetchedAt: new Date().toISOString(),
    games,
    executables: executableIndex,
  }
}

function uniqueExecutableRules(
  rules: DiscordExecutableRule[],
): DiscordExecutableRule[] {
  return rules
    .sort((left, right) => right.score - left.score)
    .filter(
      (rule, index, items) =>
        items.findIndex((candidate) => candidate.gameId === rule.gameId) ===
        index,
    )
}

function emptyDetectionCache(): DiscordDetectionCache {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    source: "discord-detectable",
    sourceUrl: DISCORD_DETECTABLE_URL,
    fetchedAt: null,
    games: [],
    executables: {},
  }
}

function cacheIsFresh(cachePath: string): boolean {
  const cache = readDetectionCache(cachePath)
  const fetchedAt =
    cache && typeof cache.fetchedAt === "string"
      ? Date.parse(cache.fetchedAt)
      : Number.NaN
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < CACHE_TTL_MS
}

function readDetectionCache(cachePath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(cachePath, "utf8"))
    return recordValue(parsed)
  } catch {
    return null
  }
}

function writeDetectionCache(
  cachePath: string,
  cache: DiscordDetectionCache,
): void {
  const temporaryPath = `${cachePath}.${process.pid}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`)
    renameSync(temporaryPath, cachePath)
  } catch (cause) {
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // Best effort cleanup; preserve the original write/rename error.
    }
    throw cause
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function arrayStrings(value: unknown): string[] {
  return [...new Set(arrayValue(value).map(stringValue).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  )
}

function executableKey(value: string): string {
  return basename(value.replaceAll("\\", "/")).trim().toLowerCase()
}
