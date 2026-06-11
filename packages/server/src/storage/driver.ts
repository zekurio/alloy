import type { UploadTicket } from "@alloy/contracts"

export interface ResolvedObject {
  stream: (opts?: {
    start?: number
    end?: number
  }) => ReadableStream<Uint8Array>
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

export interface StorageDriver {
  /**
   * Server-side write. Returns the byte length actually written so the
   * caller can echo it back into Content-Length / clip asset metadata.
   */
  put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
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
   * Materialize a stored object as a local file — media processing needs a
   * filesystem path it can read directly. Fs driver hardlinks; remote
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
    contentType: string,
  ): Promise<{ size: number }>

  /** Copy an existing object to another key, replacing Content-Type metadata. */
  copy(input: {
    fromKey: string
    toKey: string
    contentType: string
  }): Promise<{ size: number }>
}

export function clipAssetDir(clipId: string): string {
  const hex = clipId.replace(/-/g, "")
  const aa = hex.slice(0, 2)
  const bb = hex.slice(2, 4)
  // Keys are relative to the clip-store root (ALLOY_CLIPS_DIR), which already
  // means "clips", so no `clips/` prefix here.
  return `${aa}/${bb}/${clipId}`
}

type ClipAssetRole = "source" | "thumb" | "thumb-small"

const CLIP_ASSET_EXTENSION: Record<ClipAssetRole, string> = {
  source: "",
  thumb: ".webp",
  "thumb-small": ".webp",
}

export function clipAssetKey(clipId: string, role: ClipAssetRole): string {
  return `${clipAssetDir(clipId)}/${role}${CLIP_ASSET_EXTENSION[role]}`
}

function userAssetDir(userId: string): string {
  const hex = userId.replace(/-/g, "")
  const aa = hex.slice(0, 2)
  const bb = hex.slice(2, 4)
  return `users/${aa}/${bb}/${userId}`
}

export type UserAssetRole = "avatar" | "banner" | "background"

export function userAssetKey(
  userId: string,
  role: UserAssetRole,
  ext: string,
): string {
  return `${userAssetDir(userId)}/${role}${ext}`
}

export type { UploadTicket } from "@alloy/contracts"
