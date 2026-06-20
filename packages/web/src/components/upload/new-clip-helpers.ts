import {
  ACCEPTED_CLIP_CONTENT_TYPES,
  type AcceptedContentType,
  type ClipPrivacy,
} from "@alloy/api"

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
  steamgriddbId: number | null
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

const ACCEPTED_CLIP_CONTENT_TYPE_SET = new Set<string>(
  ACCEPTED_CLIP_CONTENT_TYPES,
)

const FALLBACK_CLIP_CONTENT_TYPE = ACCEPTED_CLIP_CONTENT_TYPES[0]

const EXTENSION_CONTENT_TYPE_ALIASES: Record<string, AcceptedContentType> = {
  mp4: FALLBACK_CLIP_CONTENT_TYPE,
  m4v: FALLBACK_CLIP_CONTENT_TYPE,
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
  if (!contentType) throw new Error("Unsupported file type")
  const meta = await probeFile(file)
  return { ...meta, contentType }
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
