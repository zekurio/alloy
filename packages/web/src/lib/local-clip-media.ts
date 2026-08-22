import type { ClipRow } from "@alloy/api"
import type { RecordingLibraryItem } from "@alloy/contracts"

const SOURCE_DURATION_TOLERANCE_MS = 1_500
const FINAL_COPY_DURATION_TOLERANCE_MS = 100

type ClipTimeline = Pick<
  ClipRow,
  "id" | "durationMs" | "sourceDurationMs" | "trimStartMs" | "trimEndMs"
>

export interface LocalClipMediaWindow {
  startMs: number
  endMs: number
}

/**
 * Local range that represents the server's uncut uploaded source. The editor
 * uses this mapping so its time zero stays aligned after a keyframe snap.
 */
export function localClipSourceWindow(
  item: RecordingLibraryItem,
  clip: ClipTimeline,
): LocalClipMediaWindow | null {
  if (item.uploadedClipId !== clip.id) return null

  const source = linkedSourceWindow(item, clip)
  if (source) return source
  if (clip.trimStartMs !== null || clip.trimEndMs !== null) return null

  const sourceDurationMs = positiveMs(clip.sourceDurationMs ?? clip.durationMs)
  if (!sourceDurationMs) return null
  if (!durationMatches(item.durationMs, sourceDurationMs)) return null
  return boundedWindow(0, sourceDurationMs, item.durationMs)
}

/** Local range that represents the final published clip. */
export function localClipPlaybackWindow(
  item: RecordingLibraryItem,
  clip: ClipTimeline,
): LocalClipMediaWindow | null {
  if (item.uploadedClipId !== clip.id) return null

  const source = linkedSourceWindow(item, clip)
  if (source) {
    const sourceDurationMs = source.endMs - source.startMs
    const relativeStartMs = clip.trimStartMs ?? 0
    const relativeEndMs = clip.trimEndMs ?? sourceDurationMs
    if (relativeStartMs < 0 || relativeEndMs <= relativeStartMs) return null
    if (relativeEndMs > sourceDurationMs + SOURCE_DURATION_TOLERANCE_MS) {
      return null
    }
    const endMs = Math.min(source.endMs, source.startMs + relativeEndMs)
    const window = { startMs: source.startMs + relativeStartMs, endMs }
    if (!windowMatchesClip(window, clip.durationMs)) return null
    return window
  }

  const durationMs = positiveMs(item.durationMs)
  if (!durationMs) return null
  const tolerance =
    clip.trimStartMs === null && clip.trimEndMs === null
      ? SOURCE_DURATION_TOLERANCE_MS
      : FINAL_COPY_DURATION_TOLERANCE_MS
  if (!durationMatches(item.durationMs, clip.durationMs, tolerance)) return null
  return { startMs: 0, endMs: durationMs }
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

function linkedSourceWindow(
  item: RecordingLibraryItem,
  clip: ClipTimeline,
): LocalClipMediaWindow | null {
  return mappedSourceWindow(item, clip) ?? legacySourceWindow(item, clip)
}

function mappedSourceWindow(
  item: RecordingLibraryItem,
  clip: ClipTimeline,
): LocalClipMediaWindow | null {
  const startMs = nonnegativeMs(item.uploadedClipSourceStartMs)
  const linkedDurationMs = positiveMs(item.uploadedClipSourceDurationMs)
  if (startMs === null || !linkedDurationMs) return null

  const sourceDurationMs = positiveMs(clip.sourceDurationMs) ?? linkedDurationMs
  if (!durationMatches(linkedDurationMs, sourceDurationMs)) return null
  return boundedWindow(startMs, sourceDurationMs, item.durationMs)
}

/**
 * Older links have no explicit source offset. A saved local trim can recover
 * it when both trim ranges still describe the same final clip.
 */
function legacySourceWindow(
  item: RecordingLibraryItem,
  clip: ClipTimeline,
): LocalClipMediaWindow | null {
  const localStartMs = nonnegativeMs(item.trimStartMs)
  const localEndMs = positiveMs(item.trimEndMs)
  const clipStartMs = nonnegativeMs(clip.trimStartMs)
  const clipEndMs = positiveMs(clip.trimEndMs)
  const sourceDurationMs = positiveMs(clip.sourceDurationMs)
  if (
    localStartMs === null ||
    localEndMs === null ||
    clipStartMs === null ||
    clipEndMs === null ||
    !sourceDurationMs
  ) {
    return null
  }
  if (localEndMs <= localStartMs || clipEndMs <= clipStartMs) return null
  if (
    !durationMatches(
      localEndMs - localStartMs,
      clipEndMs - clipStartMs,
      FINAL_COPY_DURATION_TOLERANCE_MS,
    )
  ) {
    return null
  }

  const sourceStartMs = localStartMs - clipStartMs
  if (sourceStartMs < 0) return null
  if (
    Math.abs(sourceStartMs + sourceDurationMs - localEndMs) >
    FINAL_COPY_DURATION_TOLERANCE_MS
  ) {
    return null
  }
  return boundedWindow(sourceStartMs, sourceDurationMs, item.durationMs)
}

function boundedWindow(
  startMs: number,
  durationMs: number,
  localDurationMs: number | null,
): LocalClipMediaWindow | null {
  const localDuration = positiveMs(localDurationMs)
  if (!localDuration || startMs >= localDuration) return null
  const endMs = Math.min(startMs + durationMs, localDuration)
  if (
    !durationMatches(endMs - startMs, durationMs, SOURCE_DURATION_TOLERANCE_MS)
  ) {
    return null
  }
  return { startMs, endMs }
}

function windowMatchesClip(
  window: LocalClipMediaWindow,
  clipDurationMs: number | null,
): boolean {
  return durationMatches(
    window.endMs - window.startMs,
    clipDurationMs,
    SOURCE_DURATION_TOLERANCE_MS,
  )
}

function durationMatches(
  leftMs: number | null,
  rightMs: number | null,
  toleranceMs = SOURCE_DURATION_TOLERANCE_MS,
): boolean {
  const left = positiveMs(leftMs)
  const right = positiveMs(rightMs)
  return Boolean(left && right && Math.abs(left - right) <= toleranceMs)
}

function nonnegativeMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return Number.isFinite(value) && value >= 0 ? value : null
}

function positiveMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return Number.isFinite(value) && value > 0 ? value : null
}
