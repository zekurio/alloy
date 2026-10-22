import type {
  AcceptedContentType,
  ClipPrivacy,
  GameRow,
  UserSearchResult,
} from "@alloy/api"
import {
  contentTypeForFile,
  type RecordingLibraryExport,
} from "@alloy/desktop-contracts"
import { t } from "@alloy/i18n"

import type { ScreenshotEdit } from "@/components/media/screenshot-edit"
import {
  prepareSelectedClipFile,
  type PublishPayload,
} from "@/components/upload/new-clip-helpers"
import type {
  PublishClipFn,
  PublishClipResult,
} from "@/components/upload/upload-flow-context"
import { prepareWebUploadPayload } from "@/components/upload/web-upload-action"
import { nullableClipDescription, parseTagString } from "@/lib/clip-fields"
import type { AlloyTauriDesktop } from "@/lib/desktop"

import type { LibraryItemView } from "./library-data"

const ACCEPTED_EXPORT_TYPES = new Set<AcceptedContentType>(["video/mp4"])

type CapturePublishInput = {
  screenshotEdit?: ScreenshotEdit
  desktop: AlloyTauriDesktop
  item: LibraryItemView
  trim: { startMs: number; endMs: number }
  /** Already normalized and non-empty. */
  title: string
  description: string
  tags: string
  game: GameRow | null
  privacy: ClipPrivacy
  mentions: UserSearchResult[]
  publishClip: PublishClipFn
}

function acceptedContentType(value: string): AcceptedContentType {
  for (const accepted of ACCEPTED_EXPORT_TYPES) {
    if (accepted === value) return accepted
  }
  throw new Error("Exported clip type is not supported for upload.")
}

/**
 * Enqueues a capture publish job. The upload flow owns the slow export/probe
 * work so the editor can return to the library immediately.
 */
export async function exportAndPublishCapture(
  input: CapturePublishInput,
): Promise<PublishClipResult> {
  return input.publishClip({
    kind: "deferred",
    title: input.title,
    sizeBytes: estimatedExportSizeBytes(input.item, input.trim),
    thumbUrl: input.item.thumbnailUrl,
    thumbBlurHash: input.item.thumbBlurHash,
    localCaptureId: input.item.id,
    prepare: (signal) => prepareCapturePublishPayload(input, signal),
  })
}

async function prepareCapturePublishPayload(
  input: CapturePublishInput,
  signal: AbortSignal,
) {
  throwIfAborted(signal)
  if (input.item.kind === "screenshot") {
    const response = await fetch(input.item.mediaUrl, { signal })
    if (!response.ok) throw new Error(t("Could not read screenshot."))
    const file = new File([await response.blob()], input.item.fileName, {
      type: contentTypeForFile(input.item.fileName),
    })
    const payload = await prepareWebUploadPayload(
      await prepareSelectedClipFile(file),
      { ...input, trimmed: false },
      signal,
    )
    return { ...payload, localCaptureId: input.item.id }
  }
  // The host stream-copies the selection from the keyframe before it and
  // reports the selection as a trim, so the server's cut is the only encode.
  const exported = await input.desktop.recording.exportLibraryCapture({
    id: input.item.id,
    segments: [{ startMs: input.trim.startMs, endMs: input.trim.endMs }],
    allowServerTrim: true,
  })
  let blob: Blob
  try {
    throwIfAborted(signal)
    const response = await fetch(exported.mediaUrl, { signal })
    if (!response.ok) throw new Error("Could not read exported clip.")
    blob = await response.blob()
  } finally {
    // The blob holds the bytes from here on, whether or not the upload
    // succeeds; retries reuse it. The host may delete its render now.
    // Hosts that predate the release keep it until the next export.
    void input.desktop.recording
      .releaseLibraryExport?.(exported.id)
      .catch(() => {})
  }
  throwIfAborted(signal)
  const contentType = acceptedContentType(exported.contentType)
  const file = new File([blob], exported.fileName, {
    type: contentType,
    lastModified: Date.now(),
  })
  // The host measured the export with ffprobe. Probing it again in a video
  // element would also fail for codecs this WebView cannot decode, such as
  // HEVC without a platform decoder, although the server takes them.
  const media = exportedMedia(exported) ?? (await prepareSelectedClipFile(file))
  throwIfAborted(signal)
  const serverTrim = exportTrim(exported)
  const payload: PublishPayload = {
    file,
    contentType,
    title: input.title,
    description: nullableClipDescription(input.description),
    tags: parseTagString(input.tags),
    gameId: input.game?.id ?? null,
    privacy: input.privacy,
    width: media.width,
    height: media.height,
    durationMs: media.durationMs,
    sizeBytes: file.size,
    mentionedUserIds: input.mentions.map((mention) => mention.id),
    trimStartMs: serverTrim?.startMs,
    trimEndMs: serverTrim?.endMs,
    localCaptureId: input.item.id,
    // The upload is this range of the capture, trimmed or not.
    localClipSource: {
      startMs: exported.sourceStartMs,
      durationMs: exported.sourceEndMs - exported.sourceStartMs,
    },
  }
  return payload
}

/** The export's shape as the host measured it, when it reported all of it. */
function exportedMedia(
  exported: RecordingLibraryExport,
): { width: number; height: number; durationMs: number } | null {
  const { width, height, durationMs } = exported
  if (width === null || height === null || !(durationMs > 0)) return null
  return { width, height, durationMs }
}

/** The selection within a wider export; null when the export is the cut. */
function exportTrim(
  exported: RecordingLibraryExport,
): { startMs: number; endMs: number } | null {
  const startMs = exported.trimStartMs ?? null
  const endMs = exported.trimEndMs ?? null
  if (startMs === null || endMs === null) return null
  return { startMs, endMs }
}

function estimatedExportSizeBytes(
  item: LibraryItemView,
  trim: { startMs: number; endMs: number },
): number {
  if (!item.durationMs || item.durationMs <= 0) return item.sizeBytes
  const ratio = Math.max(0, trim.endMs - trim.startMs) / item.durationMs
  return Math.max(1, Math.round(item.sizeBytes * Math.min(1, ratio)))
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Upload aborted", "AbortError")
  }
}
