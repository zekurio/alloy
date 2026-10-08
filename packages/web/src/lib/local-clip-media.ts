import type { ClipRow } from "@alloy/api"
import type { RecordingLibraryItem } from "@alloy/desktop-contracts"

/**
 * Slack between a recorded range and a probed duration. Exports are exact
 * cuts, so the two differ by at most a frame or an audio packet.
 */
const RANGE_TOLERANCE_MS = 100

/** Mirrors the exporter's rule for uploading a recording whole. */
const WHOLE_FILE_TOLERANCE_MS = 50

type PublishedClip = Pick<
  ClipRow,
  "id" | "sourceVersion" | "trimStartMs" | "trimEndMs"
>
type SourceClip = PublishedClip & Pick<ClipRow, "sourceDurationMs">

export interface LocalClipMediaWindow {
  startMs: number
  endMs: number
}

export interface LocalClipSource {
  item: RecordingLibraryItem
  window: LocalClipMediaWindow
}

/**
 * The linked local file whose whole content is the clip's published media.
 * A download qualifies while the server still publishes the version it was
 * saved from. A recording qualifies when it was uploaded whole and the clip
 * is untrimmed; a recording uploaded as a cut never does.
 */
export function localClipPublishedCopy(
  items: readonly RecordingLibraryItem[],
  clip: PublishedClip,
): RecordingLibraryItem | null {
  const untrimmed = !clipTrimmed(clip)
  return (
    items.find(
      (item) =>
        item.uploadedClipId === clip.id &&
        (isCurrentDownload(item, clip) || (untrimmed && uploadedWhole(item))),
    ) ?? null
  )
}

/**
 * The linked local file range that holds the clip's uncut server source, so
 * the editor's time zero is the source's. Recordings map through their
 * uploaded range. A download only holds the source while the clip is
 * untrimmed. Before the server has probed the source, the uploaded range
 * stands in for its duration.
 */
export function localClipSource(
  items: readonly RecordingLibraryItem[],
  clip: SourceClip,
): LocalClipSource | null {
  const linked = items.filter((item) => item.uploadedClipId === clip.id)
  for (const item of linked) {
    const window = recordingSourceWindow(item, clip)
    if (window) return { item, window }
  }
  if (clipTrimmed(clip)) return null
  for (const item of linked) {
    if (!isCurrentDownload(item, clip)) continue
    const window = fitWindow(
      0,
      positiveMs(clip.sourceDurationMs) ?? positiveMs(item.durationMs),
      item.durationMs,
    )
    if (window) return { item, window }
  }
  return null
}

export function mediaWindowSeconds(window: LocalClipMediaWindow) {
  return { start: window.startMs / 1_000, end: window.endMs / 1_000 }
}

/** Cache-busted URL for local media that may be replaced in place. */
export function versionedLocalMediaUrl(
  item: Pick<RecordingLibraryItem, "mediaUrl" | "modifiedAt" | "sizeBytes">,
) {
  const url = new URL(item.mediaUrl)
  url.searchParams.set("v", `${item.modifiedAt}-${item.sizeBytes ?? 0}`)
  return url.href
}

function clipTrimmed(clip: PublishedClip): boolean {
  return clip.trimStartMs !== null || clip.trimEndMs !== null
}

function isCurrentDownload(
  item: RecordingLibraryItem,
  clip: PublishedClip,
): boolean {
  return (
    Boolean(item.uploadedClipMediaVersion) &&
    item.uploadedClipMediaVersion === clip.sourceVersion
  )
}

function uploadedRange(
  item: RecordingLibraryItem,
): LocalClipMediaWindow | null {
  const startMs = item.uploadedClipSourceStartMs
  const durationMs = positiveMs(item.uploadedClipSourceDurationMs)
  if (startMs === null || !(startMs >= 0) || durationMs === null) return null
  return { startMs, endMs: startMs + durationMs }
}

function uploadedWhole(item: RecordingLibraryItem): boolean {
  const range = uploadedRange(item)
  const fileDurationMs = positiveMs(item.durationMs)
  if (!range || fileDurationMs === null) return false
  return (
    range.startMs <= WHOLE_FILE_TOLERANCE_MS &&
    range.endMs >= fileDurationMs - WHOLE_FILE_TOLERANCE_MS
  )
}

function recordingSourceWindow(
  item: RecordingLibraryItem,
  clip: SourceClip,
): LocalClipMediaWindow | null {
  const range = uploadedRange(item)
  if (!range) return null
  const uploadedMs = range.endMs - range.startMs
  const sourceMs = positiveMs(clip.sourceDurationMs) ?? uploadedMs
  if (Math.abs(sourceMs - uploadedMs) > RANGE_TOLERANCE_MS) return null
  return fitWindow(range.startMs, sourceMs, item.durationMs)
}

/** The window of `lengthMs` at `startMs`, when the file is long enough. */
function fitWindow(
  startMs: number,
  lengthMs: number | null,
  fileDurationMs: number | null,
): LocalClipMediaWindow | null {
  const fileMs = positiveMs(fileDurationMs)
  if (lengthMs === null || fileMs === null || startMs >= fileMs) return null
  const endMs = Math.min(startMs + lengthMs, fileMs)
  if (endMs - startMs < lengthMs - RANGE_TOLERANCE_MS) return null
  return { startMs, endMs }
}

function positiveMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return Number.isFinite(value) && value > 0 ? value : null
}
