import type {
  AcceptedContentType,
  ClipPrivacy,
  GameRow,
  UserSearchResult,
} from "@alloy/api"
import { CLIP_AUDIO_TRACKS_MAX } from "@alloy/contracts/content"
import { isClipAudioTrackKind } from "@alloy/contracts/desktop-recording-types"

import {
  prepareSelectedClipFile,
  type PublishPayload,
} from "@/components/upload/new-clip-helpers"
import type {
  PublishClipFn,
  PublishClipResult,
} from "@/components/upload/upload-flow-context"
import { nullableClipDescription, parseTagString } from "@/lib/clip-fields"
import type { AlloyDesktop } from "@/lib/desktop"

import type { LibraryItemView } from "./library-data"

const ACCEPTED_EXPORT_TYPES = new Set<AcceptedContentType>(["video/mp4"])

type CapturePublishInput = {
  desktop: AlloyDesktop
  item: LibraryItemView
  trim: { startMs: number; endMs: number }
  /** Whether `trim` is a real sub-range of the source (editor `trimmed`). */
  trimmed: boolean
  /** Already normalized and non-empty. */
  title: string
  description: string
  tags: string
  game: GameRow | null
  privacy: ClipPrivacy
  mentions: UserSearchResult[]
  publishClip: PublishClipFn
  posterUrl?: string | null
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
    thumbUrl: input.posterUrl ?? input.item.thumbnailUrl,
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
  const exported = await input.desktop.recording.exportLibraryCapture({
    id: input.item.id,
    segments: [{ startMs: input.trim.startMs, endMs: input.trim.endMs }],
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
  const audioTracks = input.item.audioTracks
    ?.toSorted((left, right) => left.index - right.index)
    .flatMap((track) => {
      if (!isClipAudioTrackKind(track.kind)) return []
      return [{ kind: track.kind, label: track.label }]
    })
    .slice(0, CLIP_AUDIO_TRACKS_MAX)

  const payload: PublishPayload = {
    file: selected.file,
    contentType: selected.contentType,
    title: input.title,
    description: nullableClipDescription(input.description),
    tags: parseTagString(input.tags),
    gameId: input.game?.id ?? null,
    privacy: input.privacy,
    width: selected.width,
    height: selected.height,
    durationMs: selected.durationMs,
    sizeBytes: selected.sizeBytes,
    mentionedUserIds: input.mentions.map((mention) => mention.id),
    localCaptureId: input.item.id,
    localClipSource: {
      startMs: Math.max(
        0,
        Math.round(input.trim.startMs - exported.startOffsetMs),
      ),
      durationMs: Math.max(1, Math.round(selected.durationMs)),
    },
    // Exports report the keyframe-snap offset; sending the exact
    // file-relative range lets the server cut the requested frames out of
    // the slightly longer packet-copy file. Full-range publishes send none.
    // Rounded at this boundary because the initiate schema requires integers.
  }
  if (audioTracks && audioTracks.length > 0) payload.audioTracks = audioTracks
  if (input.trimmed) {
    payload.trimStartMs = Math.round(exported.startOffsetMs)
    payload.trimEndMs = Math.round(
      exported.startOffsetMs + input.trim.endMs - input.trim.startMs,
    )
  }
  return payload
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
