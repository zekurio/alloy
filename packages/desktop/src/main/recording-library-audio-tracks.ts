import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  type Stats,
} from "node:fs"
import { join } from "node:path"

import type { RecordingLibraryItem } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app } from "electron"

import { pruneCaptureCache } from "./recording-library-cache-files"
import { findRecordingLibraryItem } from "./recording-library-scan"
import {
  AUDIO_HOST,
  MEDIA_PROTOCOL,
  thumbnailSignature,
} from "./recording-library-shared"

const logger = createLogger("library")

/** Upper bound for the stem cache; least-recently-served entries go first. */
const MAX_AUDIO_TRACK_CACHE_BYTES = 1024 * 1024 * 1024

/**
 * On-disk cache of per-source audio stems extracted from local multi-track
 * captures, so the web app's audio mixer can decode individual tracks (the
 * `<video>` element only ever plays the embedded mix). Entries are named
 * `<signature>.<track>.m4a` after the capture's mtime/size signature like the
 * thumbnail and scrubber caches, so editing the file invalidates stale stems.
 * Unlike those caches the entries are tens of MB each, so a size-budgeted
 * LRU sweep bounds the folder.
 */

/** In-flight jobs keyed by capture signature; one job extracts every stem. */
const extractions = new Map<string, Promise<void>>()

/**
 * Fetchable `alloy-capture://` URL for one audio track of a local capture,
 * or null when the capture is gone or does not carry that track. Resolving
 * the URL extracts the capture's stems, so the ensuing fetch serves from
 * disk.
 */
export async function recordingCaptureAudioTrackUrl(
  id: string,
  index: number,
): Promise<string | null> {
  const filename = await recordingCaptureAudioTrackFile(id, index)
  if (!filename) return null
  return `${MEDIA_PROTOCOL}://${AUDIO_HOST}/${id}/${index}`
}

/**
 * Path of the extracted stem for `id`'s container audio track `index`,
 * extracting the capture's stems on first use. Null when the capture or
 * track is missing or the extraction fails.
 */
export async function recordingCaptureAudioTrackFile(
  id: string,
  index: number,
): Promise<string | null> {
  const item = findRecordingLibraryItem(id)
  if (!item?.audioTracks?.some((track) => track.index === index)) return null

  let stat: Stats
  try {
    stat = statSync(item.filename)
  } catch {
    return null
  }
  const signature = thumbnailSignature(id, stat)
  const out = stemPath(signature, index)
  if (existsSync(out)) {
    touchStem(out)
    return out
  }

  const pending = extractions.get(signature) ?? startExtraction(item, signature)
  try {
    await pending
  } catch (cause) {
    logger.warn("failed to extract capture audio tracks:", cause)
    return null
  }
  // A capture delete may have raced the job and swept its outputs already.
  return existsSync(out) ? out : null
}

/** Clears every cached stem for a deleted capture. */
export function pruneRecordingCaptureAudioTracks(id: string): void {
  // An impossible "keep" path clears every cached file for the id.
  pruneCaptureCache(audioTrackFolder(), id, { path: "" })
}

function startExtraction(
  item: RecordingLibraryItem,
  signature: string,
): Promise<void> {
  const pending = extractAllStems(item, signature)
  extractions.set(signature, pending)
  void pending
    .catch(() => undefined)
    .finally(() => extractions.delete(signature))
  return pending
}

async function extractAllStems(
  item: RecordingLibraryItem,
  signature: string,
): Promise<void> {
  // Lazy: deleting a capture also loads this module, and that path only
  // sweeps files — mediabunny stays off it.
  const { extractCaptureAudioStems } = await import("./media")
  mkdirSync(audioTrackFolder(), { recursive: true })

  // One job per capture version extracts every stem: MP4 interleaves audio
  // with video, so per-stem extraction would re-read the whole capture once
  // per track. Written to temp names and renamed only after every stem
  // succeeded, so a failed job never leaves a partial set under cache keys.
  const stems = (item.audioTracks ?? [])
    .filter((track) => track.index > 0)
    .map((track) => ({
      trackIndex: track.index,
      outPath: `${stemPath(signature, track.index)}.partial`,
    }))
  try {
    await extractCaptureAudioStems(item.filename, stems)
    for (const stem of stems) {
      renameSync(stem.outPath, stem.outPath.slice(0, -".partial".length))
    }
  } finally {
    for (const stem of stems) rmSync(stem.outPath, { force: true })
  }

  // The capture may have been deleted while the job ran; its sweep already
  // passed, so drop the fresh outputs instead of stranding them.
  if (!findRecordingLibraryItem(item.id)) {
    pruneRecordingCaptureAudioTracks(item.id)
    throw new Error("Capture was deleted during audio track extraction")
  }

  pruneCaptureCache(audioTrackFolder(), item.id, { prefix: `${signature}.` })
  sweepAudioTrackCache()
}

/** Evicts least-recently-served stems once the folder exceeds its budget. */
function sweepAudioTrackCache(): void {
  const folder = audioTrackFolder()
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return
  }

  const entries: Array<{ path: string; sizeBytes: number; mtimeMs: number }> =
    []
  for (const name of names) {
    const path = join(folder, name)
    try {
      const stat = statSync(path)
      if (stat.isFile()) {
        entries.push({ path, sizeBytes: stat.size, mtimeMs: stat.mtimeMs })
      }
    } catch {
      // Raced deletion — nothing to account for.
    }
  }

  let total = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0)
  if (total <= MAX_AUDIO_TRACK_CACHE_BYTES) return

  // Stems are immutable per signature, so mtime doubles as last-served time
  // (serving touches it): the oldest entries are the least recently used.
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
  for (const entry of entries) {
    if (total <= MAX_AUDIO_TRACK_CACHE_BYTES) break
    try {
      rmSync(entry.path, { force: true })
      total -= entry.sizeBytes
    } catch {
      // Locked entries (an open ranged read) just survive this sweep.
    }
  }
}

function touchStem(path: string): void {
  const now = new Date()
  try {
    utimesSync(path, now, now)
  } catch {
    // Best effort — a missed touch only skews LRU ordering slightly.
  }
}

function stemPath(signature: string, index: number): string {
  return join(audioTrackFolder(), `${signature}.${index}.m4a`)
}

function audioTrackFolder(): string {
  return join(app.getPath("userData"), "recording-audio-tracks")
}
