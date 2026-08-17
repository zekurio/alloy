import type { Dirent } from "node:fs"
import { lstat, readdir, readFile, rm, stat } from "node:fs/promises"
import { basename, isAbsolute, join, relative, resolve } from "node:path"

import { t } from "@alloy/contracts/schema"

import { StrictFiniteNumberSchema } from "../runtime-validation"
import type { HousekeepingResult, HousekeepingTask } from "./core"

const DAY_MS = 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000
const MAX_ASSET_CACHE_BYTES = 128 * 1024 * 1024
const MAX_AUDIO_TRACK_CACHE_BYTES = 1024 * 1024 * 1024
const MAX_THUMBNAILS = 2000
const MAX_LOG_FILES = 14
const YIELD_EVERY_ENTRIES = 64

const ALLOWED_USER_DATA_ROOTS = new Set([
  "asset-cache",
  "housekeeping",
  "recording-audio-tracks",
  "recording-exports",
  "recording-library-imports",
  "recording-scrubbers",
  "recording-thumbnails",
])
const LOG_FILE_RE =
  /^alloy-main-\d{4}-\d{2}-\d{2}(?:T\d{2}-\d{2}-\d{2}-\d{3}Z-\d+)?\.log$/
const ASSET_KEY_RE = /^[a-f0-9]{40}$/
const AUDIO_FILE_RE = /^[A-Za-z0-9_-]{12,64}-\d+-\d+\.\d+\.m4a$/
const THUMBNAIL_FILE_RE = /^[A-Za-z0-9_-]{12,64}-\d+-\d+\.jpg$/
const EXPORT_FILE_RE = /^[A-Za-z0-9_-]{12,64}\.mp4$/
const IMPORT_FILE_RE = /^[0-9a-f-]{36}\.(?:mp4|mkv|mov|webm)$/i
const AssetMetaSchema = t.object({
  lastUsedAt: StrictFiniteNumberSchema,
})

export interface DesktopHousekeepingTaskOptions {
  userData: string
  logs: string
  activeImportPaths: () => ReadonlySet<string>
  activeExportPaths: () => ReadonlySet<string>
  activeAudioPaths: () => ReadonlySet<string>
  activeAssetPaths: () => ReadonlySet<string>
  now?: () => number
}

export function createDesktopHousekeepingTasks(
  options: DesktopHousekeepingTaskOptions,
): HousekeepingTask[] {
  const roots = Object.fromEntries(
    [...ALLOWED_USER_DATA_ROOTS].map((name) => [
      name,
      allowedUserDataRoot(options.userData, name),
    ]),
  )
  const now = () => options.now?.() ?? Date.now()

  return [
    {
      id: "remove-legacy-recording-scrubbers",
      revision: 1,
      intervalMs: null,
      run: (signal) =>
        removeExactLegacyRoot(roots["recording-scrubbers"], signal),
    },
    {
      id: "prune-staged-recording-imports",
      revision: 1,
      intervalMs: SWEEP_INTERVAL_MS,
      run: (signal) =>
        removeExpiredFiles({
          root: roots["recording-library-imports"],
          pattern: IMPORT_FILE_RE,
          protectedPaths: options.activeImportPaths(),
          olderThan: now() - DAY_MS,
          signal,
        }),
    },
    {
      id: "prune-recording-exports",
      revision: 1,
      intervalMs: SWEEP_INTERVAL_MS,
      run: (signal) =>
        removeExpiredFiles({
          root: roots["recording-exports"],
          pattern: EXPORT_FILE_RE,
          protectedPaths: options.activeExportPaths(),
          olderThan: now() - DAY_MS,
          signal,
        }),
    },
    {
      id: "prune-asset-cache",
      revision: 1,
      intervalMs: SWEEP_INTERVAL_MS,
      run: (signal) =>
        pruneAssetCache(
          roots["asset-cache"],
          MAX_ASSET_CACHE_BYTES,
          options.activeAssetPaths(),
          signal,
        ),
    },
    {
      id: "prune-recording-audio-tracks",
      revision: 1,
      intervalMs: SWEEP_INTERVAL_MS,
      run: (signal) =>
        pruneSizedCache({
          root: roots["recording-audio-tracks"],
          pattern: AUDIO_FILE_RE,
          protectedPaths: options.activeAudioPaths(),
          maxBytes: MAX_AUDIO_TRACK_CACHE_BYTES,
          partialOlderThan: now() - DAY_MS,
          signal,
        }),
    },
    {
      id: "prune-recording-thumbnails",
      revision: 1,
      intervalMs: SWEEP_INTERVAL_MS,
      run: (signal) =>
        pruneFileCountCache(
          roots["recording-thumbnails"],
          THUMBNAIL_FILE_RE,
          MAX_THUMBNAILS,
          signal,
        ),
    },
    {
      id: "prune-desktop-logs",
      revision: 1,
      intervalMs: SWEEP_INTERVAL_MS,
      run: (signal) =>
        pruneFileCountCache(
          allowedLogsRoot(options.userData, options.logs),
          LOG_FILE_RE,
          MAX_LOG_FILES,
          signal,
        ),
    },
  ]
}

export function allowedUserDataRoot(userData: string, name: string): string {
  if (!ALLOWED_USER_DATA_ROOTS.has(name)) {
    throw new Error(`Housekeeping root is not allowed: ${name}`)
  }
  return containedPath(resolve(userData), resolve(userData, name))
}

export async function removeExactLegacyRoot(
  root: string,
  signal: AbortSignal,
): Promise<HousekeepingResult> {
  signal.throwIfAborted()
  if (basename(root) !== "recording-scrubbers") {
    throw new Error("Legacy cleanup received the wrong root")
  }
  const rootInfo = await lstat(root).catch(() => null)
  if (rootInfo?.isSymbolicLink()) {
    await rm(root, { force: true })
    return { removedFiles: 1, removedBytes: 0 }
  }
  const result = await directoryUsage(root, signal)
  await rm(root, { recursive: true, force: true })
  return result
}

async function pruneAssetCache(
  root: string,
  maxBytes: number,
  protectedPaths: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<HousekeepingResult> {
  const entries = await directoryEntries(root)
  const keys = new Set(
    entries
      .map((entry) => entry.name.replace(/\.(?:bin|json)$/, ""))
      .filter((key) => ASSET_KEY_RE.test(key)),
  )
  const assets: Array<{
    key: string
    sizeBytes: number
    lastUsedAt: number
  }> = []
  const result = emptyResult()
  const activePaths = normalizedPaths(protectedPaths)

  for (const [index, key] of [...keys].entries()) {
    await yieldForScan(index, signal)
    const bodyPath = containedPath(root, join(root, `${key}.bin`))
    const metaPath = containedPath(root, join(root, `${key}.json`))
    if (activePaths.has(bodyPath) || activePaths.has(metaPath)) continue
    try {
      const body = await stat(bodyPath)
      const meta: unknown = JSON.parse(await readFile(metaPath, "utf8"))
      const parsedMeta = AssetMetaSchema.safeParse(meta)
      if (!body.isFile() || !parsedMeta.success) {
        throw new Error("Invalid asset")
      }
      assets.push({
        key,
        sizeBytes: body.size,
        lastUsedAt: parsedMeta.data.lastUsedAt,
      })
    } catch {
      addResult(result, await removeKnownFile(bodyPath))
      addResult(result, await removeKnownFile(metaPath))
    }
  }

  let totalBytes = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0)
  for (const asset of assets.sort((a, b) => a.lastUsedAt - b.lastUsedAt)) {
    if (totalBytes <= maxBytes) break
    signal.throwIfAborted()
    addResult(result, await removeKnownFile(join(root, `${asset.key}.bin`)))
    addResult(result, await removeKnownFile(join(root, `${asset.key}.json`)))
    totalBytes -= asset.sizeBytes
  }
  return result
}

async function pruneSizedCache(input: {
  root: string
  pattern: RegExp
  protectedPaths: ReadonlySet<string>
  maxBytes: number
  partialOlderThan: number
  signal: AbortSignal
}): Promise<HousekeepingResult> {
  const entries = await directoryEntries(input.root)
  const files: Array<{ path: string; sizeBytes: number; mtimeMs: number }> = []
  const result = emptyResult()
  const protectedPaths = normalizedPaths(input.protectedPaths)

  for (const [index, entry] of entries.entries()) {
    await yieldForScan(index, input.signal)
    if (!entry.isFile()) continue
    const path = containedPath(input.root, join(input.root, entry.name))
    if (protectedPaths.has(resolve(path))) continue
    const info = await stat(path).catch(() => null)
    if (!info) continue
    if (
      entry.name.endsWith(".partial") &&
      input.pattern.test(entry.name.slice(0, -".partial".length))
    ) {
      if (info.mtimeMs < input.partialOlderThan) {
        addResult(result, await removeKnownFile(path, info.size))
      }
      continue
    }
    if (!input.pattern.test(entry.name)) continue
    files.push({ path, sizeBytes: info.size, mtimeMs: info.mtimeMs })
  }

  let totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0)
  for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (totalBytes <= input.maxBytes) break
    input.signal.throwIfAborted()
    addResult(result, await removeKnownFile(file.path, file.sizeBytes))
    totalBytes -= file.sizeBytes
  }
  return result
}

async function removeExpiredFiles(input: {
  root: string
  pattern: RegExp
  protectedPaths: ReadonlySet<string>
  olderThan: number
  signal: AbortSignal
}): Promise<HousekeepingResult> {
  const entries = await directoryEntries(input.root)
  const protectedPaths = normalizedPaths(input.protectedPaths)
  const result = emptyResult()
  for (const [index, entry] of entries.entries()) {
    await yieldForScan(index, input.signal)
    if (!entry.isFile() || !input.pattern.test(entry.name)) continue
    const path = containedPath(input.root, join(input.root, entry.name))
    if (protectedPaths.has(resolve(path))) continue
    const info = await stat(path).catch(() => null)
    if (!info || info.mtimeMs >= input.olderThan) continue
    addResult(result, await removeKnownFile(path, info.size))
  }
  return result
}

async function pruneFileCountCache(
  root: string,
  pattern: RegExp,
  maxFiles: number,
  signal: AbortSignal,
): Promise<HousekeepingResult> {
  const files: Array<{ path: string; sizeBytes: number; mtimeMs: number }> = []
  for (const [index, entry] of (await directoryEntries(root)).entries()) {
    await yieldForScan(index, signal)
    if (!entry.isFile() || !pattern.test(entry.name)) continue
    const path = containedPath(root, join(root, entry.name))
    const info = await stat(path).catch(() => null)
    if (info) files.push({ path, sizeBytes: info.size, mtimeMs: info.mtimeMs })
  }

  const result = emptyResult()
  const expired = files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(maxFiles)
  for (const file of expired) {
    signal.throwIfAborted()
    addResult(result, await removeKnownFile(file.path, file.sizeBytes))
  }
  return result
}

async function directoryUsage(
  root: string,
  signal: AbortSignal,
): Promise<HousekeepingResult> {
  const result = emptyResult()
  for (const [index, entry] of (await directoryEntries(root)).entries()) {
    await yieldForScan(index, signal)
    const path = containedPath(root, join(root, entry.name))
    const info = await stat(path).catch(() => null)
    if (!info) continue
    result.removedFiles += 1
    if (info.isFile()) result.removedBytes += info.size
  }
  return result
}

async function directoryEntries(root: string): Promise<Dirent[]> {
  const rootInfo = await lstat(root).catch(() => null)
  if (!rootInfo || rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
    return []
  return readdir(root, { withFileTypes: true }).catch(() => [])
}

async function removeKnownFile(
  path: string,
  knownSize?: number,
): Promise<HousekeepingResult> {
  const size = knownSize ?? (await stat(path).catch(() => null))?.size ?? 0
  try {
    await rm(path, { force: true })
    return { removedFiles: 1, removedBytes: size }
  } catch {
    return emptyResult()
  }
}

function allowedLogsRoot(userData: string, logs: string): string {
  const root = resolve(logs)
  if (root !== resolve(userData, "logs")) {
    throw new Error("Housekeeping logs root is not the app logs directory")
  }
  return containedPath(resolve(userData), root)
}

function containedPath(root: string, candidate: string): string {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  const child = relative(normalizedRoot, normalizedCandidate)
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error(`Housekeeping path escapes its root: ${candidate}`)
  }
  return normalizedCandidate
}

function normalizedPaths(paths: ReadonlySet<string>): Set<string> {
  return new Set([...paths].map((path) => resolve(path)))
}

async function yieldForScan(index: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (index === 0 || index % YIELD_EVERY_ENTRIES !== 0) return
  await new Promise<void>((resolve) => setImmediate(resolve))
  signal.throwIfAborted()
}

function emptyResult(): HousekeepingResult {
  return { removedFiles: 0, removedBytes: 0 }
}

function addResult(
  target: HousekeepingResult,
  source: HousekeepingResult,
): void {
  target.removedFiles += source.removedFiles
  target.removedBytes += source.removedBytes
}
