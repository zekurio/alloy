import { Buffer } from "node:buffer"
import { createHmac, timingSafeEqual } from "node:crypto"
import { createReadStream, createWriteStream, promises as fsp } from "node:fs"
import path from "node:path"
import type { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import type {
  DownloadUrl,
  MintDownloadUrlInput,
  MintUploadUrlInput,
  ResolvedObject,
  StorageDriver,
  UploadTicket,
} from "./driver"

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
      headers: { "Content-Type": input.contentType },
      expiresAt,
    }
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const src = this.fullPath(key)
    await fsp.mkdir(path.dirname(destPath), { recursive: true })
    try {
      await fsp.rm(destPath, { force: true })
      await fsp.link(src, destPath)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "EXDEV" && code !== "EPERM" && code !== "ENOSYS") throw err
    }
    await fsp.copyFile(src, destPath)
  }

  async uploadFromFile(
    localPath: string,
    key: string,
    _contentType: string
  ): Promise<{ size: number }> {
    const dst = this.fullPath(key)
    await fsp.mkdir(path.dirname(dst), { recursive: true })
    await fsp.rm(dst, { force: true })
    try {
      await fsp.link(localPath, dst)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "EXDEV" && code !== "EPERM" && code !== "ENOSYS") throw err
      await fsp.copyFile(localPath, dst)
    }
    const stat = await fsp.stat(dst)
    return { size: stat.size }
  }

  async mintDownloadUrl(
    _key: string,
    _input: MintDownloadUrlInput
  ): Promise<DownloadUrl | null> {
    // Fs driver has no presigned-URL concept — callers fall back to
    // streaming through resolve().
    return null
  }

  async delete(key: string): Promise<void> {
    const full = this.fullPath(key)
    try {
      await fsp.rm(full, { force: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return
      throw err
    }
    await this.pruneEmptyAncestors(path.dirname(full))
  }

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

export function signToken(payload: UploadTokenPayload, secret: string): string {
  const json = Buffer.from(JSON.stringify(payload), "utf8")
  const sig = createHmac("sha256", secret).update(json).digest()
  return `${json.toString("base64url")}.${sig.toString("base64url")}`
}

export type DecodedToken =
  | { ok: true; payload: UploadTokenPayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" }

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
