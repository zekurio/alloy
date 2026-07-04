import {
  ACCEPTED_CLIP_CONTENT_TYPES,
  type AcceptedContentType,
  type ClipPrivacy,
} from "@alloy/api"
import { t } from "@alloy/i18n"

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
  /**
   * Kept source range in the uploaded file's timeline; the server derives the
   * cut at ingest. Absent when the whole file is kept or the file was already
   * cut client-side (desktop).
   */
  trimStartMs?: number
  trimEndMs?: number
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

/**
 * Content-type/extension gate plus a `<video>`-element metadata probe. The
 * probe doubles as validation: a file the browser cannot demux is rejected
 * here, and deeper codec/stream checks happen server-side when the media run
 * ffprobes the ingested source.
 */
export async function prepareSelectedClipFile(
  file: File,
): Promise<SelectedFile> {
  const contentType = resolveContentType(file)
  if (!contentType) throw new Error(t("Choose an MP4 video file."))
  const meta = await probeFile(file)
  return { ...meta, contentType }
}

export function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".")
  return idx > 0 ? filename.slice(0, idx) : filename
}

/**
 * The file's extension as a short uppercase label (e.g. "MP4"), or null when
 * the name has no recognizable extension. Used to give file summaries a
 * meaningful type chip instead of a generic placeholder icon.
 */
export function fileExtensionLabel(filename: string): string | null {
  const idx = filename.lastIndexOf(".")
  if (idx <= 0 || idx === filename.length - 1) return null
  const ext = filename.slice(idx + 1)
  if (ext.length > 5 || /[^a-z0-9]/i.test(ext)) return null
  return ext.toUpperCase()
}

export { type ProbedFile, probeFile }
