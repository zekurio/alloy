import { createReadStream } from "node:fs"
import { mkdir, readdir, rm, stat, utimes, writeFile } from "node:fs/promises"
import { Readable } from "node:stream"

import { logger } from "alloy-logging"
import {
  ALL_FORMATS,
  CmafOutputFormat,
  Conversion,
  FilePathSource,
  FilePathTarget,
  HlsOutputFormat,
  Input,
  Output,
  PathedTarget,
} from "mediabunny"

import { ENCODE_DIR } from "../runtime/dirs"
import { isAbsolute, join, relative, resolve } from "../runtime/path"
import { clipStorage } from "../storage"
import {
  DIRECT_HLS_MASTER,
  DIRECT_HLS_TARGET_DURATION_SEC,
  type DirectHlsSpec,
  isServableDirectHlsFile,
} from "./direct-hls-spec"

export {
  DIRECT_HLS_MASTER,
  directHlsContentType,
  type DirectHlsSpec,
  isServableDirectHlsFile,
  makeDirectHlsSpec,
} from "./direct-hls-spec"

const DIRECT_HLS_DIR = join(ENCODE_DIR, "hls")
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const CACHE_MAX_BYTES = 20 * 1024 * 1024 * 1024
// Written last; a directory without it is a partial package and gets wiped.
const COMPLETE_MARKER = ".complete"

/** Ensure the clip's HLS package exists, then open `filename` from it. */
export async function readDirectHlsFile(
  spec: DirectHlsSpec,
  filename: string,
): Promise<{ size: number; body: ReadableStream<Uint8Array> }> {
  if (!isServableDirectHlsFile(filename)) {
    throw new Error(`Invalid direct HLS filename: ${filename}`)
  }
  await ensureDirectHlsPackage(spec)
  const filePath = join(packageDir(spec.cacheKey), filename)
  const fileStat = await stat(filePath)
  return {
    size: fileStat.size,
    body: Readable.toWeb(
      createReadStream(filePath),
    ) as ReadableStream<Uint8Array>,
  }
}

const packagingJobs = new Map<string, Promise<void>>()
const activeConversions = new Set<Conversion>()

/**
 * Package the clip's source into a VOD HLS tree (stream copy, no re-encode)
 * if it is not already cached. Concurrent callers share one packaging run.
 */
export async function ensureDirectHlsPackage(
  spec: DirectHlsSpec,
): Promise<void> {
  const markerPath = join(packageDir(spec.cacheKey), COMPLETE_MARKER)
  if (await fileExists(markerPath)) {
    // Refresh the eviction clock; reads are what keep a package alive.
    const now = new Date()
    await utimes(markerPath, now, now).catch(() => undefined)
    return
  }

  const running = packagingJobs.get(spec.cacheKey)
  if (running) return running

  const job = packageClip(spec).finally(() => {
    packagingJobs.delete(spec.cacheKey)
  })
  packagingJobs.set(spec.cacheKey, job)
  return job
}

async function packageClip(spec: DirectHlsSpec): Promise<void> {
  const dir = packageDir(spec.cacheKey)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  // "source" never matches the servable-filename pattern, so the staged
  // download can live inside the package dir without being reachable.
  const sourcePath = join(dir, "source")

  try {
    await clipStorage.downloadToFile(spec.sourceKey, sourcePath)

    const input = new Input({
      source: new FilePathSource(sourcePath),
      formats: ALL_FORMATS,
    })
    try {
      const output = new Output({
        format: new HlsOutputFormat({
          segmentFormat: new CmafOutputFormat(),
          targetDuration: DIRECT_HLS_TARGET_DURATION_SEC,
        }),
        target: new PathedTarget(
          DIRECT_HLS_MASTER,
          ({ path }) => new FilePathTarget(resolveWithin(dir, path)),
        ),
      })
      // Without an explicit trim start, Conversion clamps the timeline to 0
      // and re-encodes (here: discards, no WebCodecs) any track that starts
      // earlier — which AAC tracks with encoder priming always do. Starting
      // at the true first timestamp keeps every track on the copy path.
      const firstTimestamp = await input.getFirstTimestamp()
      const conversion = await Conversion.init({
        input,
        output,
        tracks: "primary",
        showWarnings: false,
        trim: firstTimestamp < 0 ? { start: firstTimestamp } : undefined,
      })
      if (!conversion.isValid) {
        const reasons = conversion.discardedTracks
          .map((track) => track.reason)
          .join(", ")
        throw new Error(
          `source cannot be repackaged without transcoding (${reasons || "unknown"})`,
        )
      }
      activeConversions.add(conversion)
      try {
        await conversion.execute()
      } finally {
        activeConversions.delete(conversion)
      }
    } finally {
      input.dispose()
    }

    await rm(sourcePath, { force: true })
    await writeFile(join(dir, COMPLETE_MARKER), "")
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw new Error(
      `direct HLS packaging failed for clip ${spec.clipId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    )
  }

  void cleanupDirectHlsCache({ deleteAllPartial: false }).catch((err) => {
    logger.warn("[clips] direct HLS cache cleanup failed:", err)
  })
}

export async function startDirectHlsCache(): Promise<void> {
  await mkdir(DIRECT_HLS_DIR, { recursive: true })
  await cleanupDirectHlsCache({ deleteAllPartial: true })
}

export async function stopDirectHlsCache(): Promise<void> {
  for (const conversion of activeConversions) {
    await conversion.cancel().catch(() => undefined)
  }
  activeConversions.clear()
}

function packageDir(cacheKey: string): string {
  return join(DIRECT_HLS_DIR, cacheKey)
}

/** Resolve a (relative) mediabunny output path, refusing dir escapes. */
function resolveWithin(dir: string, path: string): string {
  const target = resolve(dir, path)
  const rel = relative(dir, target)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Unexpected direct HLS output path: ${path}`)
  }
  return target
}

interface CacheEntry {
  path: string
  mtimeMs: number
  sizeBytes: number
}

async function cleanupDirectHlsCache(opts: {
  deleteAllPartial: boolean
}): Promise<void> {
  const entries = await readdir(DIRECT_HLS_DIR, {
    withFileTypes: true,
  }).catch(() => [])
  const now = Date.now()
  const cacheEntries: CacheEntry[] = []

  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue
    if (packagingJobs.has(dirent.name)) continue
    const path = join(DIRECT_HLS_DIR, dirent.name)
    const marker = await stat(join(path, COMPLETE_MARKER)).catch(() => null)
    const isPartial = marker === null
    if (
      (isPartial && opts.deleteAllPartial) ||
      (marker && now - marker.mtimeMs > CACHE_TTL_MS)
    ) {
      await rm(path, { recursive: true, force: true })
      continue
    }
    if (isPartial) continue
    cacheEntries.push({
      path,
      mtimeMs: marker.mtimeMs,
      sizeBytes: await dirSize(path),
    })
  }

  let total = cacheEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0)
  for (const entry of cacheEntries.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= CACHE_MAX_BYTES) break
    await rm(entry.path, { recursive: true, force: true })
    total -= entry.sizeBytes
  }
}

async function dirSize(path: string): Promise<number> {
  let total = 0
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await dirSize(child)
    else total += (await stat(child).catch(() => null))?.size ?? 0
  }
  return total
}

async function fileExists(path: string): Promise<boolean> {
  return stat(path)
    .then((info) => info.isFile())
    .catch(() => false)
}
