import type {
  CompleteMultipartUploadPart,
  UploadPartTicket,
  UploadTicket,
  UploadTicketRole,
} from "@alloy/contracts"

export type UploadTicketStorageState = {
  type: "s3-multipart"
  uploadId: string
} | null

export interface MintedUploadTicket {
  ticket: UploadTicket
  storageState: UploadTicketStorageState
}

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
  /** Expected upload size. FS enforces during upload; finalize verifies all drivers. */
  maxBytes: number
  /** Time-to-live for the ticket, in seconds. */
  expiresInSec: number
  userId: string
  /** Bind the ticket to the reserved clip row (defence-in-depth). */
  clipId: string
  role: UploadTicketRole
}

export interface MintUploadPartUrlInput {
  key: string
  uploadId: string
  partNumber: number
  expiresInSec: number
}

export interface WriteUploadPartInput {
  key: string
  partNumber: number
  partSizeBytes: number
  maxBytes: number
  body: ReadableStream<Uint8Array>
}

export interface CompleteUploadInput {
  key: string
  contentType: string
  maxBytes: number
  partSizeBytes?: number
  storageState: UploadTicketStorageState
  parts?: CompleteMultipartUploadPart[]
}

export interface AbortUploadInput {
  key: string
  storageState: UploadTicketStorageState
}

export interface MintDownloadUrlInput {
  /** Storage key of the object the URL will serve. */
  key: string
  /** Time-to-live for the signed URL, in seconds. */
  expiresInSec: number
  /** Response Content-Type baked into the signed URL. */
  contentType?: string
  /** Full `Content-Disposition` header value baked into the signed URL —
   * lets attachment downloads keep their filename without proxying. */
  contentDisposition?: string
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
  mintUploadUrl(input: MintUploadUrlInput): Promise<MintedUploadTicket>

  /** Issue a browser-bound URL for one native multipart upload part. */
  mintUploadPartUrl(input: MintUploadPartUrlInput): Promise<UploadPartTicket>

  /** Store one server-mediated upload part, used by the filesystem driver. */
  writeUploadPart(input: WriteUploadPartInput): Promise<{ size: number }>

  /** Publish a resumable upload into its final staged object. */
  completeUpload(input: CompleteUploadInput): Promise<void>

  /** Best-effort cleanup for resumable upload state. */
  abortUpload(input: AbortUploadInput): Promise<void>

  /**
   * Issue a short-lived browser-bound GET URL so clients pull bytes
   * straight from the backing store. Returns `null` when the driver can
   * only serve through the server (fs) — callers fall back to resolve().
   */
  mintDownloadUrl(input: MintDownloadUrlInput): Promise<string | null>

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
  // Keys are relative to the configured clip-store root, which already means
  // "clips", so no `clips/` prefix here.
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
  return `${aa}/${bb}/${userId}`
}

export type UserAssetRole = "avatar" | "banner"

export function userAssetKey(
  userId: string,
  role: UserAssetRole,
  ext: string,
): string {
  return `${userAssetDir(userId)}/${role}${ext}`
}

export type {
  CompleteMultipartUploadPart,
  UploadPartTicket,
  UploadTicket,
  UploadTicketStrategy,
} from "@alloy/contracts"
