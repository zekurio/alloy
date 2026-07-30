import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  type Dirent,
  type Stats,
} from "node:fs"
import { join } from "node:path"

import type { RecordingLibraryItem } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app } from "electron"

import { extractAudioTrackMp4 } from "./media"
import { pruneCaptureCache } from "./recording-library-cache-files"
import { findRecordingLibraryItem } from "./recording-library-scan"
import {
  AUDIO_HOST,
  MEDIA_PROTOCOL,
  thumbnailSignature,
} from "./recording-library-shared"

const logger = createLogger("library")

/**
 * On-disk cache of per-source audio stems extracted from local multi-track
 * captures, so the web app's audio mixer can decode individual tracks (the
 * `<video>` element only ever plays the embedded mix). Entries are named
 * after the capture's mtime/size signature like the thumbnail and scrubber
 * caches, so editing the file invalidates stale stems.
 */

/** In-flight extractions keyed by output path so concurrent requests share. */
const extractions = new Map<string, Promise<string>>()

/**
 * Fetchable `alloy-capture://` URL for one audio track of a local capture,
 * or null when the capture is gone or does not carry that track. Resolving
 * the URL extracts the stem, so the ensuing fetch serves from disk.
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
 * extracting it on first use. Null when the capture or track is missing or
 * the extraction fails.
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
  const out = join(audioTrackFolder(), `${signature}.${index}.m4a`)
  if (existsSync(out)) return out

  const pending = extractions.get(out) ?? startExtraction(item, index, out)
  try {
    await pending
    pruneStaleAudioTracks(id, signature)
    return out
  } catch (cause) {
    logger.warn("failed to extract capture audio track:", cause)
    return null
  }
}

/** Clears every cached stem for a deleted capture. */
export function pruneRecordingCaptureAudioTracks(id: string): void {
  // Passing an impossible "keep" name clears every cached file for the id.
  pruneCaptureCache(audioTrackFolder(), id, "")
}

function startExtraction(
  item: RecordingLibraryItem,
  index: number,
  out: string,
): Promise<string> {
  const pending = (async () => {
    mkdirSync(audioTrackFolder(), { recursive: true })
    // Written to a temp name and renamed so a crashed extraction never leaves
    // a partial file behind under the cache key.
    const partial = `${out}.partial`
    try {
      await extractAudioTrackMp4(item.filename, partial, index)
      renameSync(partial, out)
    } finally {
      rmSync(partial, { force: true })
    }
    return out
  })()
  extractions.set(out, pending)
  void pending.catch(() => undefined).finally(() => extractions.delete(out))
  return pending
}

/** Drops stems generated from another version of the same capture. */
function pruneStaleAudioTracks(id: string, currentSignature: string): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(audioTrackFolder(), { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(`${id}-`)) continue
    if (entry.name.startsWith(`${currentSignature}.`)) continue
    try {
      rmSync(join(audioTrackFolder(), entry.name), { force: true })
    } catch {
      // Best effort — a locked stale file just lingers until the next pass.
    }
  }
}

function audioTrackFolder(): string {
  return join(app.getPath("userData"), "recording-audio-tracks")
}
