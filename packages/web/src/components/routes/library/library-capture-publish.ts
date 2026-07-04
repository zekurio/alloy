import type {
  AcceptedContentType,
  ClipPrivacy,
  GameRow,
  UserSearchResult,
} from "@alloy/api"

import {
  captureThumbnail,
  type CapturedThumbnail,
  prepareSelectedClipFile,
  thumbnailFromImageUrl,
} from "@/components/upload/new-clip-helpers"
import type { PublishClipResult } from "@/components/upload/upload-flow-context"
import type { useUploadFlowControls } from "@/components/upload/use-upload-flow-controls"
import { clientLogger } from "@/lib/client-log"
import { nullableClipDescription, parseTagString } from "@/lib/clip-fields"
import type { AlloyDesktop } from "@/lib/desktop"

import type { LibraryItemView } from "./library-data"

const ACCEPTED_EXPORT_TYPES = new Set<AcceptedContentType>(["video/mp4"])

function acceptedContentType(value: string): AcceptedContentType {
  if (ACCEPTED_EXPORT_TYPES.has(value as AcceptedContentType)) {
    return value as AcceptedContentType
  }
  throw new Error("Exported clip type is not supported for upload.")
}

/**
 * Enqueues a capture publish job. The upload flow owns the slow export/probe
 * work so the editor can return to the library immediately.
 */
export async function exportAndPublishCapture({
  desktop,
  item,
  trim,
  title,
  description,
  tags,
  game,
  privacy,
  mentions,
  publishClip,
  posterUrl,
}: {
  desktop: AlloyDesktop
  item: LibraryItemView
  trim: { startMs: number; endMs: number }
  /** Already normalized and non-empty. */
  title: string
  description: string
  tags: string
  game: GameRow | null
  privacy: ClipPrivacy
  mentions: UserSearchResult[]
  publishClip: ReturnType<typeof useUploadFlowControls>["publishClip"]
  posterUrl?: string | null
}): Promise<PublishClipResult> {
  return publishClip({
    kind: "deferred",
    title,
    sizeBytes: estimatedExportSizeBytes(item, trim),
    thumbUrl: posterUrl ?? item.thumbnailUrl,
    thumbBlurHash: item.thumbBlurHash,
    localCaptureId: item.id,
    prepare: (signal) =>
      prepareCapturePublishPayload({
        desktop,
        item,
        trim,
        title,
        description,
        tags,
        game,
        privacy,
        mentions,
        signal,
      }),
  })
}

async function prepareCapturePublishPayload({
  desktop,
  item,
  trim,
  title,
  description,
  tags,
  game,
  privacy,
  mentions,
  signal,
}: {
  desktop: AlloyDesktop
  item: LibraryItemView
  trim: { startMs: number; endMs: number }
  title: string
  description: string
  tags: string
  game: GameRow | null
  privacy: ClipPrivacy
  mentions: UserSearchResult[]
  signal: AbortSignal
}) {
  throwIfAborted(signal)
  const exported = await desktop.recording.exportLibraryCapture({
    id: item.id,
    segments: [{ startMs: trim.startMs, endMs: trim.endMs }],
  })
  throwIfAborted(signal)
  const response = await fetch(exported.mediaUrl, { signal })
  if (!response.ok) throw new Error("Could not read exported clip.")
  const blob = await response.blob()
  throwIfAborted(signal)
  const contentType = acceptedContentType(exported.contentType)
  const file = new File([blob], exported.fileName, {
    type: contentType,
    lastModified: Date.now(),
  })
  const selected = await prepareSelectedClipFile(file)
  throwIfAborted(signal)
  const posterAtMs = Math.min(1000, Math.max(0, selected.durationMs - 100))
  const thumbnail = await capturePoster(
    exported.thumbUrl,
    selected.file,
    posterAtMs,
  )
  throwIfAborted(signal)
  const thumbBlurHash = thumbnail
    ? (thumbnail.blurHash ?? (await hashPosterBlob(desktop, thumbnail.blob)))
    : null

  return {
    file: selected.file,
    contentType: selected.contentType,
    title,
    description: nullableClipDescription(description),
    tags: parseTagString(tags),
    gameId: game?.id ?? null,
    privacy,
    width: selected.width,
    height: selected.height,
    durationMs: selected.durationMs,
    sizeBytes: selected.sizeBytes,
    thumbBlob: thumbnail?.blob ?? null,
    thumbBlurHash,
    mentionedUserIds: mentions.map((mention) => mention.id),
    localCaptureId: item.id,
  }
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

/**
 * Prefers the library poster when one is available; otherwise samples the
 * selected video file near the publish point.
 */
async function capturePoster(
  thumbUrl: string | null,
  file: File,
  posterAtMs: number,
): Promise<CapturedThumbnail | null> {
  if (thumbUrl) {
    try {
      return await thumbnailFromImageUrl(thumbUrl)
    } catch (cause) {
      clientLogger.warn("[upload] Cached poster is not usable.", cause)
      // Fall through to capturing from the video file.
    }
  }
  try {
    return await captureThumbnail(file, posterAtMs)
  } catch (cause) {
    clientLogger.warn("[upload] Could not capture a usable poster.", cause)
    return null
  }
}

async function hashPosterBlob(
  desktop: AlloyDesktop,
  blob: Blob,
): Promise<string | null> {
  if (!desktop.recording.hashLibraryThumbnail) return null
  try {
    return await desktop.recording.hashLibraryThumbnail(
      new Uint8Array(await blob.arrayBuffer()),
    )
  } catch (cause) {
    clientLogger.warn("[upload] Could not compute poster BlurHash.", cause)
    return null
  }
}
