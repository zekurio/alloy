import { Buffer } from "node:buffer"
import { createHmac, timingSafeEqual } from "node:crypto"
import { createReadStream, createWriteStream, promises as fsp } from "node:fs"
import path from "node:path"
import type { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import type {
  MintUploadUrlInput,
  ResolvedObject,
  StorageDriver,
  UploadTicket,
} from "./driver"

/**
 * Filesystem implementation of `StorageDriver`. Files live under a single
 * `root` directory; `storageKey` is the relative path inside that root.
 *
 * Uploads are served by `fs-upload-route.ts` — `mintUploadUrl()` returns
 * a token-bearing URL there and the route validates the token using the
 * same `decodeUploadToken()` exported below.
 */
export interface FsDriverOptions {
  root: string
  publicBaseUrl: string
  hmacSecret: string
}

export interface UploadTokenPayload {
  /** key — opaque storage key the bytes will land at */
  k: string
  /** contentType — MIME baked into the ticket */
  ct: string
  /** maxBytes — hard cap for the upload */
  mb: number
  /** exp — unix-seconds expiry */
  exp: number
  /** userId — auth-session owner the ticket was minted for */
  uid: string
  /** clipId — reserved clip row the ticket targets */
  cid: string
}

export class FsStorageDriver implements StorageDriver {
  constructor(private readonly opts: FsDriverOptions) {}

  /** Resolve a storageKey against the configured root. */
  fullPath(key: string): string {
    return path.join(this.opts.root, key)
  }

  async put(
    key: string,
    body: Buffer | Readable,
    _contentType: string
  ): Promise<{ size: number }> {
    const dst = this.fullPath(key)
    await fsp.mkdir(path.dirname(dst), { recursive: true })

    if (Buffer.isBuffer(body)) {
      await fsp.writeFile(dst, body)
      return { size: body.byteLength }
    }

    // Stream — count bytes as they pass through so we can return size.
    let size = 0
    const out = createWriteStream(dst)
    const counter = async function* (src: Readable) {
      for await (const chunk of src) {
        size += (chunk as Buffer).byteLength
        yield chunk
      }
    }
    await pipeline(body, counter, out)
    return { size }
  }

  async resolve(key: string): Promise<ResolvedObject | null> {
    const full = this.fullPath(key)
    let stat: Awaited<ReturnType<typeof fsp.stat>>
    try {
      stat = await fsp.stat(full)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
      throw err
    }
    if (!stat.isFile()) return null

    return {
      stream: (opts) =>
        createReadStream(full, {
          start: opts?.start,
          end: opts?.end,
        }),
      size: stat.size,
      // The fs driver doesn't carry Content-Type metadata sidecar — that
      // lives on `clip.contentType` in the DB. Callers always have the
      // row in hand by the time they call `resolve`, so they can override
      // this. We do an extension-based best guess so callers that don't
      // have the row (e.g. dev tools poking the file directly) get
      // something sensible.
      contentType: contentTypeForExt(path.extname(full)),
      lastModified: stat.mtime,
    }
  }

  async mintUploadUrl(input: MintUploadUrlInput): Promise<UploadTicket> {
    const expiresAt = Math.floor(Date.now() / 1000) + input.expiresInSec
    const payload: UploadTokenPayload = {
      k: input.key,
      ct: input.contentType,
      mb: input.maxBytes,
      exp: expiresAt,
      uid: input.userId,
      cid: input.clipId,
    }
    const token = signToken(payload, this.opts.hmacSecret)
    const baseUrl = this.opts.publicBaseUrl.replace(/\/+$/, "")
    return {
      uploadUrl: `${baseUrl}/storage/upload/${token}`,
      method: "POST",
      // Pin Content-Type to the value baked into the HMAC payload. The
      // upload route compares these and 400s on mismatch, so we can't let
      // the browser fall back to `Blob.type` — MKVs in particular come
      // through as `video/matroska` in Firefox while we normalise to
      // `video/x-matroska` at the client. Handing the client the exact
      // string to echo keeps the two in lockstep.
      headers: { "Content-Type": input.contentType },
      expiresAt,
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.fullPath(key)
    try {
      await fsp.rm(full, { force: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return
      throw err
    }
    // Sweep empty ancestor directories so deleting the last file in a
    // clip's shard (`clips/aa/bb/<clipId>/`) doesn't leave the folder
    // tree behind. Stops at the storage root or the first non-empty
    // dir — shard dirs shared with other clips stay put.
    await this.pruneEmptyAncestors(path.dirname(full))
  }

  /**
   * Walk upward from `startDir`, `rmdir`-ing each directory while it's
   * empty. Stops on `ENOTEMPTY`, when we reach the configured storage
   * root, or if the computed relative path ever escapes root (defensive
   * — shouldn't happen with well-formed keys, but keeps an out-of-tree
   * rmdir from being possible even if one did).
   */
  private async pruneEmptyAncestors(startDir: string): Promise<void> {
    const root = path.resolve(this.opts.root)
    let current = path.resolve(startDir)
    while (true) {
      const rel = path.relative(root, current)
      if (rel === "" || rel.startsWith("..")) return
      try {
        await fsp.rmdir(current)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        // Non-empty = done (sibling clips still occupy this shard).
        // Missing = someone else already cleaned it — also done.
        if (code === "ENOTEMPTY" || code === "ENOENT" || code === "EEXIST") {
          return
        }
        throw err
      }
      current = path.dirname(current)
    }
  }
}

// ─── HMAC token helpers ────────────────────────────────────────────────

/**
 * Sign and serialise a token. Format: `base64url(payload).<hmac>`.
 *
 * The HMAC is over the raw payload bytes (not the base64url string) so
 * we don't rely on the encoder being canonical for the signature to be
 * stable. `decodeUploadToken` recomputes the HMAC over the same bytes
 * after base64url-decoding the payload.
 */
export function signToken(payload: UploadTokenPayload, secret: string): string {
  const json = Buffer.from(JSON.stringify(payload), "utf8")
  const sig = createHmac("sha256", secret).update(json).digest()
  return `${json.toString("base64url")}.${sig.toString("base64url")}`
}

export type DecodedToken =
  | { ok: true; payload: UploadTokenPayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" }

/**
 * Verify a token and return the decoded payload. The check is in three
 * steps so the upload route can attribute failures (and so a malformed
 * token never reaches the HMAC compare path with mismatched lengths,
 * which would throw rather than fail).
 */
export function decodeUploadToken(token: string, secret: string): DecodedToken {
  const dot = token.indexOf(".")
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: "malformed" }
  }
  const payloadB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)

  let payloadBytes: Buffer
  let sigBytes: Buffer
  try {
    payloadBytes = Buffer.from(payloadB64, "base64url")
    sigBytes = Buffer.from(sigB64, "base64url")
  } catch {
    return { ok: false, reason: "malformed" }
  }
  if (payloadBytes.byteLength === 0 || sigBytes.byteLength !== 32) {
    return { ok: false, reason: "malformed" }
  }

  const expected = createHmac("sha256", secret).update(payloadBytes).digest()
  // `timingSafeEqual` requires equal-length buffers; the byte-length
  // check above gates that. Wrong-length sigs already returned malformed.
  if (!timingSafeEqual(expected, sigBytes)) {
    return { ok: false, reason: "bad-signature" }
  }

  let payload: UploadTokenPayload
  try {
    payload = JSON.parse(payloadBytes.toString("utf8")) as UploadTokenPayload
  } catch {
    return { ok: false, reason: "malformed" }
  }
  if (
    typeof payload.k !== "string" ||
    typeof payload.ct !== "string" ||
    typeof payload.mb !== "number" ||
    typeof payload.exp !== "number" ||
    typeof payload.uid !== "string" ||
    typeof payload.cid !== "string"
  ) {
    return { ok: false, reason: "malformed" }
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" }
  }
  return { ok: true, payload }
}

// ─── Misc ──────────────────────────────────────────────────────────────

function contentTypeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".mp4":
      return "video/mp4"
    case ".mov":
      return "video/quicktime"
    case ".mkv":
      return "video/x-matroska"
    case ".webm":
      return "video/webm"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".png":
      return "image/png"
    case ".webp":
      return "image/webp"
    default:
      return "application/octet-stream"
  }
}
