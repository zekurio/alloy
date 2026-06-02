import {
  ACCEPTED_CLIP_CONTENT_TYPES,
  type AcceptedContentType,
  type ClipPrivacy,
} from "@workspace/api"
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
  gameId: string
  privacy: Visibility
  width: number
  height: number
  durationMs: number
  sizeBytes: number
  trimStartMs: number | null
  trimEndMs: number | null
  thumbBlob: Blob
  mentionedUserIds: string[]
}

const CONTENT_TYPE_ALIASES: Record<string, AcceptedContentType> = {
  "video/mp4": "video/mp4",
  "video/quicktime": "video/quicktime",
  "video/x-matroska": "video/x-matroska",
  "video/matroska": "video/x-matroska",
  "video/webm": "video/webm",
}

const EXTENSION_TO_CONTENT_TYPE: Record<string, AcceptedContentType> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
}

export const ACCEPT_LIST = `${
  ACCEPTED_CLIP_CONTENT_TYPES.join(",")
},.mp4,.m4v,.mov,.mkv,.webm`

function resolveContentType(file: File): AcceptedContentType | null {
  const byMime = CONTENT_TYPE_ALIASES[file.type]
  if (byMime) return byMime
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  return EXTENSION_TO_CONTENT_TYPE[ext] ?? null
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

export { captureFrames, captureThumbnail } from "./new-clip-media"
export { type ProbedFile, probeFile }
