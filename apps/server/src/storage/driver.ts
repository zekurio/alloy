import type { Readable } from "node:stream"

/**
 * Generic storage driver. The fs implementation lives next door
 * (`fs-driver.ts`) and is the only one that exists today; an `s3` driver
 * (and any other future backing store) drops in here without touching
 * call sites — `clip.storageKey` is just an opaque string from the
 * driver's point of view.
 *
 * The shape is deliberately small. Three things are abstracted over:
 *
 *   - **Server-side writes** (`put`) — the encode worker uses this to
 *     push the encoded video and the two thumbnails. The HMAC-signed
 *     direct-from-browser path goes through `mintUploadUrl`, not this.
 *
 *   - **Range-capable reads** (`resolve`) — the proxied stream endpoint
 *     and the thumbnail endpoint both consume `ResolvedObject.stream({
 *     start, end })`. For S3 this would wrap `GetObject` with a
 *     `Range:` header; for fs it's `createReadStream({ start, end })`.
 *
 *   - **Browser-bound upload tickets** (`mintUploadUrl`) — `initiate`
 *     issues these and returns them to the client. For the fs driver the
 *     URL points back at our own Hono server (handled by
 *     `fs-upload-route.ts`); for S3 it would be a real pre-signed PUT
 *     URL straight at the bucket.
 */

export interface UploadTicket {
  /** Absolute URL the browser PUTs/POSTs the file to. */
  uploadUrl: string
  /** HTTP method the browser must use (`PUT` for S3, `POST` for fs). */
  method: "PUT" | "POST"
  /**
   * Headers the browser must echo on the upload. For S3 this is at
   * minimum `Content-Type` (signed-into the URL). For fs this is empty
   * because the HMAC payload already binds the content type — we don't
   * need the browser to repeat it.
   */
  headers: Record<string, string>
  /** Unix-seconds expiry. UI greys out the publish button past this. */
  expiresAt: number
}

export interface ResolvedObject {
  /**
   * Open a Range-capable read stream over the object. Both bounds are
   * inclusive (matching HTTP `Range: bytes=A-B` and Node's
   * `createReadStream({ start, end })`). Caller is responsible for
   * `pipe()`-ing this into a response and ending the stream on errors.
   */
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
  /**
   * Bind the ticket to the authenticated user. A stolen ticket can only
   * overwrite the source bytes for one specific clip belonging to one
   * specific user — and `/finalize` then refuses to act on it because
   * `authorId` mismatches the requesting session.
   */
  userId: string
  /** Bind the ticket to the reserved clip row (defence-in-depth). */
  clipId: string
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
}

/**
 * Compose the `clip/<aa>/<bb>/<clipId>/<role><ext>` storage key for a
 * clip asset. `aa/bb` are the first 4 hex chars of `clipId` so a single
 * directory never holds millions of clips.
 *
 * Roles with a fixed output format carry an extension so ffmpeg can pick
 * the muxer from the filename (otherwise it errors with "Unable to
 * choose an output format") and so `contentTypeForExt` in the fs driver
 * returns the right MIME when a caller resolves the object without a
 * row in hand. `source` stays extensionless — the upload format varies
 * per-clip and ffmpeg sniffs input containers from the bytes anyway.
 *
 * Lives here so both the driver and the route layer can reach for the
 * same conventions without duplicating the layout.
 */
export type ClipAssetRole = "source" | "video" | "thumb" | "thumb-small"

const CLIP_ASSET_EXTENSION: Record<ClipAssetRole, string> = {
  source: "",
  video: ".mp4",
  thumb: ".jpg",
  "thumb-small": ".jpg",
}

export function clipAssetKey(clipId: string, role: ClipAssetRole): string {
  // Use the raw uuid hex (no dashes) for the shard so the directory tree
  // is stable regardless of uuid string formatting.
  const hex = clipId.replace(/-/g, "")
  const aa = hex.slice(0, 2)
  const bb = hex.slice(2, 4)
  return `clips/${aa}/${bb}/${clipId}/${role}${CLIP_ASSET_EXTENSION[role]}`
}
