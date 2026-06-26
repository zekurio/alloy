import {
  ACCEPTED_CLIP_CONTENT_TYPES,
  type AcceptedContentType,
  type ClipPrivacy,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import {
  BlobSource,
  Input,
  MP4,
  type AudioCodec,
  type VideoCodec,
} from "mediabunny"

import { type ProbedFile, probeFile } from "./new-clip-media"

/** Metadata derived from a real File for display in the modal header. */
export interface SelectedFile {
  /** The actual File the parent will upload. */
  file: File
  contentType: AcceptedContentType
  name: string
  size: string
  resolution: string
  fps: string
  duration: string
  /** ms — for the server's `/initiate` body and the trim UI. */
  durationMs: number
  width: number
  height: number
  sizeBytes: number
}

export type Visibility = ClipPrivacy

export interface PublishPayload {
  file: File
  /** Canonical server-accepted MIME — see `SelectedFile.contentType`. */
  contentType: AcceptedContentType
  title: string
  description: string | null
  gameId: string | null
  privacy: Visibility
  width: number
  height: number
  durationMs: number
  sizeBytes: number
  thumbBlob: Blob
  /** Client-computed BlurHash for the poster frame, when available. */
  thumbBlurHash: string | null
  mentionedUserIds: string[]
  /** Bare, canonical hashtags for the clip. */
  tags: string[]
  /**
   * Desktop library capture this upload was published from; links the local
   * capture to the server clip once the upload finalizes.
   */
  localCaptureId?: string
}

export interface DeferredPublishPayload {
  kind: "deferred"
  title: string
  sizeBytes: number
  thumbUrl: string | null
  thumbBlurHash: string | null
  localCaptureId?: string
  prepare: (signal: AbortSignal) => Promise<PublishPayload>
}

export type PublishClipInput = PublishPayload | DeferredPublishPayload

export function isDeferredPublishPayload(
  input: PublishClipInput,
): input is DeferredPublishPayload {
  return "kind" in input && input.kind === "deferred"
}

const ACCEPTED_CLIP_CONTENT_TYPE_SET = new Set<string>(
  ACCEPTED_CLIP_CONTENT_TYPES,
)

const FALLBACK_CLIP_CONTENT_TYPE = ACCEPTED_CLIP_CONTENT_TYPES[0]

const EXTENSION_CONTENT_TYPE_ALIASES: Record<string, AcceptedContentType> = {
  mp4: FALLBACK_CLIP_CONTENT_TYPE,
}

const ACCEPTED_CLIP_EXTENSIONS = Object.keys(
  EXTENSION_CONTENT_TYPE_ALIASES,
).map((extension) => `.${extension}`)

export const ACCEPT_LIST = [
  ...ACCEPTED_CLIP_CONTENT_TYPES,
  ...ACCEPTED_CLIP_EXTENSIONS,
].join(",")

function isAcceptedContentType(value: string): value is AcceptedContentType {
  return ACCEPTED_CLIP_CONTENT_TYPE_SET.has(value)
}

function resolveContentType(file: File): AcceptedContentType | null {
  const contentType = file.type.toLowerCase()
  if (isAcceptedContentType(contentType)) return contentType

  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  return EXTENSION_CONTENT_TYPE_ALIASES[ext] ?? null
}

export async function prepareSelectedClipFile(
  file: File,
): Promise<SelectedFile> {
  const contentType = resolveContentType(file)
  if (!contentType) throw new Error(t("Choose an MP4 video file."))
  await validateUploadMp4(file)
  const meta = await probeFile(file)
  return { ...meta, contentType }
}

const SUPPORTED_MP4_VIDEO_CODECS = new Set<VideoCodec>(["avc", "hevc", "av1"])

const SUPPORTED_MP4_AUDIO_CODECS = new Set<AudioCodec>(["aac"])

async function validateUploadMp4(file: File): Promise<void> {
  const input = new Input({
    source: new BlobSource(file),
    formats: [MP4],
  })
  try {
    await assertUploadMp4(input)
  } catch (cause) {
    if (cause instanceof Error && cause.name === "UploadValidationError") {
      throw cause
    }
    throw uploadValidationError(t("Choose a valid MP4 video file."))
  } finally {
    input.dispose()
  }
}

async function assertUploadMp4(input: Input): Promise<void> {
  const video = await input.getPrimaryVideoTrack()
  if (!video) {
    throw uploadValidationError(t("MP4 uploads must contain a video track."))
  }

  const videoCodec = await video.getCodec()
  if (!videoCodec || !SUPPORTED_MP4_VIDEO_CODECS.has(videoCodec)) {
    throw uploadValidationError(
      t("MP4 uploads must use H.264, HEVC, or AV1 video."),
    )
  }

  const audioCodec = await (await input.getPrimaryAudioTrack())?.getCodec()
  if (audioCodec && !SUPPORTED_MP4_AUDIO_CODECS.has(audioCodec)) {
    throw uploadValidationError(t("MP4 uploads with audio must use AAC."))
  }

  const duration =
    (await input.getDurationFromMetadata([video], { skipLiveWait: true })) ??
    (await input.computeDuration([video], { skipLiveWait: true }))
  if (!Number.isFinite(duration) || duration <= 0) {
    throw uploadValidationError(t("Could not read video duration."))
  }

  const width = await video.getDisplayWidth()
  const height = await video.getDisplayHeight()
  if (!width || !height) {
    throw uploadValidationError(t("Could not read video dimensions."))
  }
}

function uploadValidationError(message: string): Error {
  const error = new Error(message)
  error.name = "UploadValidationError"
  return error
}

export function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".")
  return idx > 0 ? filename.slice(0, idx) : filename
}

export {
  captureThumbnail,
  thumbnailFromImageUrl,
  type CapturedThumbnail,
} from "./new-clip-media"
export { type ProbedFile, probeFile }
