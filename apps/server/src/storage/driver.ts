import type { Readable } from "node:stream"
import type { UploadTicket } from "@workspace/db/contracts"

export interface ResolvedObject {
  stream: (opts?: { start?: number; end?: number }) => Readable
  /** Byte length of the full object — used to compute Content-Length. */
  size: number
  /** Stored `Content-Type`. The clip row carries the same value but the
   * driver gets to be the source of truth at read time. */
  contentType: string
  /** Last modification time, when the driver knows it; null otherwise. */
  lastModified: Date | null
}

export interface MintUploadUrlInput {
  /** Opaque storage key the bytes will land at. Must already be unique. */
  key: string
  /** MIME type; baked into the upload ticket and stored on the row. */
  contentType: string
  /** Hard cap on the upload size, in bytes. The upload endpoint enforces. */
  maxBytes: number
  /** Time-to-live for the ticket, in seconds. */
  expiresInSec: number
  userId: string
  /** Bind the ticket to the reserved clip row (defence-in-depth). */
  clipId: string
}

export interface DownloadUrl {
  url: string
  expiresAt: number
}

export interface MintDownloadUrlInput {
  expiresInSec: number
  /** Overrides the `Content-Type` the object would otherwise serve with. */
  responseContentType?: string
  /** Attachment filename override (Content-Disposition). */
  responseContentDisposition?: string
  /** Cache-Control header to send with the signed response. */
  responseCacheControl?: string
}

export interface StorageDriver {
  /**
   * Server-side write. Returns the byte length actually written so the
   * caller can echo it back into Content-Length / `clip.sizeBytes`.
   */
  put(
    key: string,
    body: Buffer | Readable,
    contentType: string
  ): Promise<{ size: number }>

  /**
   * Stat + open. Returns `null` when the key doesn't exist — callers map
   * that to a 404 instead of treating it as a 500.
   */
  resolve(key: string): Promise<ResolvedObject | null>

  /** Issue a browser-bound upload URL. */
  mintUploadUrl(input: MintUploadUrlInput): Promise<UploadTicket>

  /** Best-effort delete; missing keys must not throw. */
  delete(key: string): Promise<void>

  /**
   * Materialize a stored object as a local file — the encoder needs a
   * filesystem path it can hand to ffmpeg. Fs driver hardlinks; remote
   * drivers download. The destination's parent dir must exist.
   */
  downloadToFile(key: string, destPath: string): Promise<void>

  /**
   * Publish a local file under a storage key. Fs driver hardlinks;
   * remote drivers stream-upload. Returns the size committed.
   */
  uploadFromFile(
    localPath: string,
    key: string,
    contentType: string
  ): Promise<{ size: number }>

  /**
   * Return a short-lived URL the browser can GET to read the object,
   * or `null` when the driver wants callers to stream through the
   * server instead. Playback/download routes 302 when non-null.
   */
  mintDownloadUrl(
    key: string,
    input: MintDownloadUrlInput
  ): Promise<DownloadUrl | null>
}

function clipAssetDir(clipId: string): string {
  const hex = clipId.replace(/-/g, "")
  const aa = hex.slice(0, 2)
  const bb = hex.slice(2, 4)
  return `clips/${aa}/${bb}/${clipId}`
}

export type ClipAssetRole = "source" | "video" | "thumb" | "thumb-small"

const CLIP_ASSET_EXTENSION: Record<ClipAssetRole, string> = {
  source: "",
  video: ".mp4",
  thumb: ".jpg",
  "thumb-small": ".jpg",
}

export function clipAssetKey(clipId: string, role: ClipAssetRole): string {
  return `${clipAssetDir(clipId)}/${role}${CLIP_ASSET_EXTENSION[role]}`
}

export function clipVideoVariantKey(clipId: string, variantId: string): string {
  const safeVariantId = variantId.replace(/[^a-z0-9-]/gi, "").toLowerCase()
  if (!safeVariantId) {
    throw new Error("clipVideoVariantKey requires a non-empty variant id")
  }
  return `${clipAssetDir(clipId)}/video-${safeVariantId}.mp4`
}

export type { UploadTicket } from "@workspace/db/contracts"
