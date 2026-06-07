import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises"
import { Readable } from "node:stream"

import type { ClipPlaybackQuality, EncoderConfig } from "alloy-contracts"
import { logger } from "alloy-logging"

import type { HwaccelKind } from "../config/store"
import { liveHls, probe, type LiveHlsOpts } from "../queue/ffmpeg"
import { join } from "../runtime/path"
import { clipStorage } from "../storage"
import { parseHlsCodecsFromInit } from "./hls-codec"
import { dirSize, fileExists, fileSizeOrZero } from "./live-hls-fs"
import {
  liveHlsPaths,
  liveHlsRootDir,
  liveHlsSegmentCount,
  liveHlsSegmentFilename,
  liveHlsSegmentLengthSec,
  parseLiveHlsSegment,
} from "./live-hls-playlist"

const JOB_IDLE_MS = 60_000
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const CACHE_MAX_BYTES = 20 * 1024 * 1024 * 1024
const WAIT_INTERVAL_MS = 100
const WAIT_TIMEOUT_MS = 60_000

export interface LiveHlsSpec {
  cacheKey: string
  clipId: string
  sourceKey: string
  codec: string
  encoder: string
  quality: ClipPlaybackQuality
  encoderConfig: EncoderConfig
}

interface LiveHlsJob {
  key: string
  startNumber: number
  activeRequests: number
  hasExited: boolean
  failed: Error | null
  kill: () => void
  done: Promise<void>
  idleTimer: NodeJS.Timeout | null
}

interface CacheEntry {
  path: string
  mtimeMs: number
  sizeBytes: number
}

const jobs = new Map<string, LiveHlsJob>()
const startLocks = new Map<string, Promise<LiveHlsJob>>()
// RFC 6381 CODECS string per cacheKey, parsed from the init segment. Content-
// addressed and deterministic, so it never goes stale for a given key.
const codecStrings = new Map<string, string>()

export {
  buildLiveHlsMediaPlaylist,
  liveHlsPaths,
  liveHlsSegmentCount,
  liveHlsSegmentFilename,
  liveHlsSegmentLengthSec,
  parseLiveHlsSegment,
} from "./live-hls-playlist"

export function makeLiveHlsSpec(input: {
  clipId: string
  sourceKey: string
  sourceSizeBytes: number | null
  updatedAt: Date | string
  quality: ClipPlaybackQuality
  codec: string
  encoder: string
  encoderConfig: EncoderConfig
}): LiveHlsSpec {
  const keyInput = {
    v: 1,
    clipId: input.clipId,
    sourceKey: input.sourceKey,
    sourceSizeBytes: input.sourceSizeBytes,
    updatedAt:
      input.updatedAt instanceof Date
        ? input.updatedAt.toISOString()
        : input.updatedAt,
    qualityId: input.quality.id,
    codec: input.codec,
    encoder: input.encoder,
    hwaccel: input.encoderConfig.hwaccel,
    qsvDevice: input.encoderConfig.qsvDevice,
    vaapiDevice: input.encoderConfig.vaapiDevice,
    intelLowPowerH264: input.encoderConfig.intelLowPowerH264,
    intelLowPowerHevc: input.encoderConfig.intelLowPowerHevc,
    tonemapping: input.encoderConfig.tonemapping,
    segmentLengthSec: liveHlsSegmentLengthSec(),
  }
  const cacheKey = createHash("sha256")
    .update(JSON.stringify(keyInput))
    .digest("hex")
    .slice(0, 32)
  return {
    cacheKey,
    clipId: input.clipId,
    sourceKey: input.sourceKey,
    codec: input.codec,
    encoder: input.encoder,
    quality: input.quality,
    encoderConfig: input.encoderConfig,
  }
}

/** Start the transcode if needed and block until `filename` is fully written,
 *  returning its on-disk path. Shared by segment serving and codec probing. */
async function ensureLiveHlsFile(
  spec: LiveHlsSpec,
  filename: string,
  durationMs: number,
  startTimeSec: number,
  signal: AbortSignal,
): Promise<string> {
  const parsed = parseLiveHlsSegment(spec.cacheKey, filename)
  if (!parsed) throw new Error("Invalid HLS segment")
  const paths = liveHlsPaths(spec.cacheKey)
  const filePath =
    parsed.kind === "init"
      ? paths.initPath
      : join(paths.dir, liveHlsSegmentFilename(spec.cacheKey, parsed.index))

  if (!jobs.has(spec.cacheKey) && !(await fileExists(filePath))) {
    const startNumber = parsed.kind === "segment" ? parsed.index : 0
    await ensureLiveHlsJob(spec, startNumber, startTimeSec)
  }
  await waitForReadyFile({ spec, filePath, parsed, durationMs, signal })
  // Serving the init is the natural, non-blocking moment to learn this
  // rendition's exact CODECS — the master playlist reads it from the cache so it
  // never has to wait on a (possibly slow, e.g. libsvtav1) transcode itself.
  if (parsed.kind === "init" && !codecStrings.has(spec.cacheKey)) {
    const codecs = parseHlsCodecsFromInit(await readFile(filePath))
    if (codecs) codecStrings.set(spec.cacheKey, codecs)
  }
  return filePath
}

export async function readLiveHlsFile(
  spec: LiveHlsSpec,
  filename: string,
  durationMs: number,
  startTimeSec: number,
  signal: AbortSignal,
): Promise<{ size: number; body: ReadableStream<Uint8Array> }> {
  const filePath = await ensureLiveHlsFile(
    spec,
    filename,
    durationMs,
    startTimeSec,
    signal,
  )
  const fileStat = await stat(filePath)
  const file = createReadStream(filePath)
  return {
    size: fileStat.size,
    body: Readable.toWeb(file) as ReadableStream<Uint8Array>,
  }
}

/**
 * The exact RFC 6381 `CODECS` value for this rendition if its init segment has
 * already been served (and parsed) this session, otherwise `null`. Never blocks
 * — the master playlist falls back to a default string until the cache warms,
 * which avoids stalling the manifest on a cold (potentially slow) transcode.
 */
export function liveHlsCachedCodecs(cacheKey: string): string | null {
  return codecStrings.get(cacheKey) ?? null
}

export async function startLiveHlsCache(): Promise<void> {
  await mkdir(liveHlsRootDir(), { recursive: true })
  await cleanupLiveHlsCache({ deleteAllPartial: true })
}

export async function stopLiveHlsCache(): Promise<void> {
  for (const job of jobs.values()) {
    job.kill()
  }
  jobs.clear()
}

async function ensureLiveHlsJob(
  spec: LiveHlsSpec,
  startNumber: number,
  startTimeSec: number,
): Promise<LiveHlsJob> {
  const existing = jobs.get(spec.cacheKey)
  if (existing && !existing.hasExited) {
    clearIdleTimer(existing)
    return existing
  }

  const locked = startLocks.get(spec.cacheKey)
  if (locked) return locked

  const started = startLiveHlsJob(spec, startNumber, startTimeSec).finally(
    () => {
      startLocks.delete(spec.cacheKey)
    },
  )
  startLocks.set(spec.cacheKey, started)
  return started
}

async function startLiveHlsJob(
  spec: LiveHlsSpec,
  startNumber: number,
  startTimeSec: number,
): Promise<LiveHlsJob> {
  const paths = liveHlsPaths(spec.cacheKey)
  await mkdir(paths.dir, { recursive: true })
  await stageSource(spec.sourceKey, paths.sourcePath)
  const sourceColor = (await probe(paths.sourcePath)).color

  const transcode = liveHls(paths.sourcePath, paths.playlistPath, {
    config: {
      hwaccel: spec.encoderConfig.hwaccel as HwaccelKind,
      encoder: spec.encoder,
      quality: 23,
      audioBitrateKbps: Math.round(spec.quality.audioBitrate / 1000),
      extraInputArgs: "",
      extraOutputArgs: "",
      qsvDevice: spec.encoderConfig.qsvDevice,
      vaapiDevice: spec.encoderConfig.vaapiDevice,
      intelLowPowerH264: spec.encoderConfig.intelLowPowerH264,
      intelLowPowerHevc: spec.encoderConfig.intelLowPowerHevc,
      tonemapping: spec.encoderConfig.tonemapping,
      sourceColor,
    },
    targetHeight: spec.quality.height,
    videoBitrate: spec.quality.videoBitrate,
    audioBitrate: spec.quality.audioBitrate,
    segmentLengthSec: liveHlsSegmentLengthSec(),
    startNumber,
    startTimeSec,
    segmentPattern: paths.segmentPattern,
    initFilename: paths.initFilename,
  } satisfies LiveHlsOpts)

  const job: LiveHlsJob = {
    key: spec.cacheKey,
    startNumber,
    activeRequests: 0,
    hasExited: false,
    failed: null,
    kill: transcode.kill,
    done: transcode.done,
    idleTimer: null,
  }
  jobs.set(spec.cacheKey, job)
  job.done
    .catch((err) => {
      job.failed = err instanceof Error ? err : new Error(String(err))
      logger.error(`[clips] live HLS transcode failed ${spec.cacheKey}:`, err)
      void cleanupFailedJob(spec.cacheKey)
    })
    .finally(() => {
      job.hasExited = true
      jobs.delete(spec.cacheKey)
      void cleanupLiveHlsCache({ deleteAllPartial: false }).catch((err) => {
        logger.warn("[clips] live HLS cache cleanup failed:", err)
      })
    })
  return job
}

async function waitForReadyFile(input: {
  spec: LiveHlsSpec
  filePath: string
  parsed: { kind: "init" } | { kind: "segment"; index: number }
  durationMs: number
  signal: AbortSignal
}): Promise<void> {
  const startedAt = Date.now()
  const job = jobs.get(input.spec.cacheKey)
  if (job) beginRequest(job)
  try {
    while (true) {
      if (input.signal.aborted) throw new DOMException("Aborted", "AbortError")
      if (input.parsed.kind === "init") {
        // ffmpeg creates the fmp4 init file empty when it opens the output and
        // only writes ftyp+moov once it has codec parameters (right as segment 0
        // lands). Returning on mere existence streams a 0-byte init, so hls.js
        // caches an empty EXT-X-MAP, fails to parse every fmp4 segment, and
        // stalls on an endless load. Wait until the header bytes are present.
        if ((await fileSizeOrZero(input.filePath)) > 0) return
      } else if (await fileExists(input.filePath)) {
        const jobNow = jobs.get(input.spec.cacheKey)
        if (!jobNow || jobNow.hasExited) return
        const lastIndex = liveHlsSegmentCount(input.durationMs) - 1
        if (input.parsed.index >= lastIndex) {
          if (jobNow.hasExited) return
        } else {
          const nextPath = join(
            liveHlsPaths(input.spec.cacheKey).dir,
            liveHlsSegmentFilename(input.spec.cacheKey, input.parsed.index + 1),
          )
          if (await fileExists(nextPath)) return
        }
      }

      const jobNow = jobs.get(input.spec.cacheKey)
      if (jobNow?.failed) throw jobNow.failed
      if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
        throw new Error("Timed out waiting for live HLS segment")
      }
      await delay(WAIT_INTERVAL_MS)
    }
  } finally {
    if (job) endRequest(job)
  }
}

async function stageSource(
  sourceKey: string,
  sourcePath: string,
): Promise<void> {
  if (await fileExists(sourcePath)) return
  await clipStorage.downloadToFile(sourceKey, sourcePath)
}

function beginRequest(job: LiveHlsJob): void {
  clearIdleTimer(job)
  job.activeRequests += 1
}

function endRequest(job: LiveHlsJob): void {
  job.activeRequests = Math.max(0, job.activeRequests - 1)
  if (job.activeRequests === 0 && !job.hasExited) {
    job.idleTimer = setTimeout(() => {
      logger.info(`[clips] stopping idle live HLS transcode ${job.key}`)
      job.kill()
    }, JOB_IDLE_MS)
  }
}

function clearIdleTimer(job: LiveHlsJob): void {
  if (!job.idleTimer) return
  clearTimeout(job.idleTimer)
  job.idleTimer = null
}

async function cleanupFailedJob(cacheKey: string): Promise<void> {
  await rm(liveHlsPaths(cacheKey).dir, { recursive: true, force: true }).catch(
    () => undefined,
  )
}

async function cleanupLiveHlsCache(opts: {
  deleteAllPartial: boolean
}): Promise<void> {
  const entries = await readdir(liveHlsRootDir(), {
    withFileTypes: true,
  }).catch(() => [])
  const dirs = entries.filter((entry) => entry.isDirectory())
  const now = Date.now()
  const cacheEntries: CacheEntry[] = []

  for (const dirent of dirs) {
    const path = join(liveHlsRootDir(), dirent.name)
    const dirStat = await stat(path).catch(() => null)
    if (!dirStat) continue
    if (opts.deleteAllPartial || now - dirStat.mtimeMs > CACHE_TTL_MS) {
      await rm(path, { recursive: true, force: true })
      continue
    }
    cacheEntries.push({
      path,
      mtimeMs: dirStat.mtimeMs,
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

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
