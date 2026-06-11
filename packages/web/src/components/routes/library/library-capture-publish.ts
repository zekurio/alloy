import type {
  AcceptedContentType,
  ClipPrivacy,
  GameRow,
  UserSearchResult,
} from "@alloy/api"

import {
  captureThumbnail,
  prepareSelectedClipFile,
  thumbnailFromImageUrl,
} from "@/components/upload/new-clip-helpers"
import type { PublishClipResult } from "@/components/upload/upload-flow-context"
import type { useUploadFlowControls } from "@/components/upload/use-upload-flow-controls"
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
 * Cuts the capture to the trimmed range via the desktop exporter, reads the
 * result back as a File, and hands it to the upload flow. Throws on any
 * failure so the caller can surface it.
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
}: {
  desktop: AlloyDesktop
  item: LibraryItemView
  trim: { startMs: number; endMs: number }
  /** Already normalized and non-empty. */
  title: string
  description: string
  tags: string
  game: GameRow
  privacy: ClipPrivacy
  mentions: UserSearchResult[]
  publishClip: ReturnType<typeof useUploadFlowControls>["publishClip"]
}): Promise<PublishClipResult> {
  const exported = await desktop.recording.exportLibraryCapture({
    id: item.id,
    segments: [{ startMs: trim.startMs, endMs: trim.endMs }],
  })
  const response = await fetch(exported.mediaUrl)
  if (!response.ok) throw new Error("Could not read exported clip.")
  const blob = await response.blob()
  const contentType = acceptedContentType(exported.contentType)
  const file = new File([blob], exported.fileName, {
    type: contentType,
    lastModified: Date.now(),
  })
  const selected = await prepareSelectedClipFile(file)
  const posterAtMs = Math.min(1000, Math.max(0, selected.durationMs - 100))
  const thumbBlob = await capturePosterBlob(
    exported.thumbUrl,
    selected.file,
    posterAtMs,
  )

  return publishClip({
    file: selected.file,
    contentType: selected.contentType,
    title,
    description: nullableClipDescription(description),
    tags: parseTagString(tags),
    steamgriddbId: game.steamgriddbId,
    privacy,
    width: selected.width,
    height: selected.height,
    durationMs: selected.durationMs,
    sizeBytes: selected.sizeBytes,
    thumbBlob,
    thumbBlurHash: exported.thumbBlurHash ?? item.thumbBlurHash,
    mentionedUserIds: mentions.map((mention) => mention.id),
    localCaptureId: item.id,
  })
}

/**
 * Prefers the library poster when one is available; otherwise samples the
 * selected video file near the publish point.
 */
async function capturePosterBlob(
  thumbUrl: string | null,
  file: File,
  posterAtMs: number,
): Promise<Blob> {
  if (thumbUrl) {
    try {
      return await thumbnailFromImageUrl(thumbUrl)
    } catch {
      // Fall through to capturing from the video file.
    }
  }
  return captureThumbnail(file, posterAtMs)
}
