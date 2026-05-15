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
    const root = normalizePath(this.opts.root)
    const resolved = normalizePath(`${root}/${key}`)
    if (resolved !== root && !resolved.startsWith(`${root}/`)) {
      throw new Error("Storage key escapes storage root")
    }
    return resolved
  }

  async put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    _contentType: string
  ): Promise<{ size: number }> {
    const dst = this.fullPath(key)
    await Deno.mkdir(dirname(dst), { recursive: true })

    if (body instanceof Uint8Array) {
      await Deno.writeFile(dst, body)
      return { size: body.byteLength }
    }

    let size = 0
    const file = await Deno.open(dst, {
      create: true,
      write: true,
      truncate: true,
    })
    try {
      for await (const chunk of body) {
        size += chunk.byteLength
        await file.write(chunk)
      }
    } finally {
      file.close()
    }
    return { size }
  }

  async resolve(key: string): Promise<ResolvedObject | null> {
    const full = this.fullPath(key)
    let stat: Deno.FileInfo
    try {
      stat = await Deno.stat(full)
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null
      throw err
    }
    if (!stat.isFile) return null

    return {
      stream: (opts) => {
        return fspCreateReadStream(full, opts?.start, opts?.end)
      },
      size: stat.size,
      contentType: contentTypeForExt(extname(full)),
      lastModified: stat.mtime ?? null,
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
    const token = await signToken(payload, this.opts.hmacSecret)
    const baseUrl = this.opts.publicBaseUrl.replace(/\/+$/, "")
    return {
      uploadUrl: `${baseUrl}/api/assets/upload/${token}`,
      method: "POST",
      headers: { "Content-Type": input.contentType },
      expiresAt,
    }
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const src = this.fullPath(key)
    await Deno.mkdir(dirname(destPath), { recursive: true })
    try {
      await Deno.remove(destPath).catch((err) => {
        if (!(err instanceof Deno.errors.NotFound)) throw err
      })
      await Deno.link(src, destPath)
      return
    } catch (err) {
      if (!isCopyFallbackError(err)) throw err
    }
    await Deno.copyFile(src, destPath)
  }

  async uploadFromFile(
    localPath: string,
    key: string,
    _contentType: string
  ): Promise<{ size: number }> {
    const dst = this.fullPath(key)
    await Deno.mkdir(dirname(dst), { recursive: true })
    await Deno.remove(dst).catch((err) => {
      if (!(err instanceof Deno.errors.NotFound)) throw err
    })
    try {
      await Deno.link(localPath, dst)
    } catch (err) {
      if (!isCopyFallbackError(err)) throw err
      await Deno.copyFile(localPath, dst)
    }
    const stat = await Deno.stat(dst)
    return { size: stat.size }
  }

  async copy(input: {
    fromKey: string
    toKey: string
    contentType: string
  }): Promise<{ size: number }> {
    const src = this.fullPath(input.fromKey)
    const dst = this.fullPath(input.toKey)
    await Deno.mkdir(dirname(dst), { recursive: true })
    await Deno.remove(dst).catch((err) => {
      if (!(err instanceof Deno.errors.NotFound)) throw err
    })
    try {
      await Deno.link(src, dst)
    } catch (err) {
      if (!isCopyFallbackError(err)) throw err
      const tmp = `${dst}.${crypto.randomUUID()}.tmp`
      await Deno.copyFile(src, tmp)
      await Deno.rename(tmp, dst)
    }
    const stat = await Deno.stat(dst)
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
      await Deno.remove(full)
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return
      throw err
    }
    await this.pruneEmptyAncestors(dirname(full))
  }

  private async pruneEmptyAncestors(startDir: string): Promise<void> {
    const root = normalizePath(this.opts.root)
    let current = normalizePath(startDir)
    while (true) {
      if (current === root || !current.startsWith(`${root}/`)) return
      try {
        await Deno.remove(current)
      } catch (err) {
        if (
          err instanceof Deno.errors.NotFound ||
          isOsErrorCode(err, "ENOTEMPTY") ||
          isOsErrorCode(err, "EEXIST")
        ) {
          return
        }
        throw err
      }
      current = dirname(current)
    }
  }
}

function fspCreateReadStream(
  path: string,
  start: number | undefined,
  end: number | undefined
): ReadableStream<Uint8Array> {
  const file = Deno.openSync(path, { read: true })
  if (start !== undefined) file.seekSync(start, Deno.SeekMode.Start)
  const limit = end === undefined ? undefined : end - (start ?? 0) + 1
  if (limit === undefined) return file.readable

  let remaining = limit
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (remaining <= 0) return
      try {
        const chunk = new Uint8Array(Math.min(64 * 1024, remaining))
        const bytesRead = await file.read(chunk)
        if (bytesRead === null) {
          remaining = 0
          file.close()
          controller.close()
          return
        }
        remaining -= bytesRead
        controller.enqueue(chunk.subarray(0, bytesRead))
        if (remaining <= 0) {
          file.close()
          controller.close()
        }
      } catch (err) {
        file.close()
        throw err
      }
    },
    cancel() {
      file.close()
    },
  })
}

function normalizePath(value: string): string {
  const absolute = value.startsWith("/") ? value : `${Deno.cwd()}/${value}`
  const parts: string[] = []
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  return `/${parts.join("/")}`
}

function dirname(value: string): string {
  const normalized = normalizePath(value)
  const index = normalized.lastIndexOf("/")
  return index <= 0 ? "/" : normalized.slice(0, index)
}

function extname(value: string): string {
  const base = value.slice(value.lastIndexOf("/") + 1)
  const index = base.lastIndexOf(".")
  return index <= 0 ? "" : base.slice(index)
}

function isCopyFallbackError(err: unknown): boolean {
  return (
    isOsErrorCode(err, "EXDEV") ||
    err instanceof Deno.errors.PermissionDenied ||
    isOsErrorCode(err, "ENOSYS")
  )
}

function isOsErrorCode(err: unknown, code: string): boolean {
  return (err as { code?: string } | null)?.code === code
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export async function signToken(
  payload: UploadTokenPayload,
  secret: string
): Promise<string> {
  const json = textEncoder.encode(JSON.stringify(payload))
  const sig = await hmacSha256(json, secret)
  return `${base64UrlEncode(json)}.${base64UrlEncode(sig)}`
}

export type DecodedToken =
  | { ok: true; payload: UploadTokenPayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" }

export async function decodeUploadToken(
  token: string,
  secret: string
): Promise<DecodedToken> {
  const dot = token.indexOf(".")
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: "malformed" }
  }
  const payloadB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)

  let payloadBytes: Uint8Array
  let sigBytes: Uint8Array
  try {
    payloadBytes = base64UrlDecode(payloadB64)
    sigBytes = base64UrlDecode(sigB64)
  } catch {
    return { ok: false, reason: "malformed" }
  }
  if (payloadBytes.byteLength === 0 || sigBytes.byteLength !== 32) {
    return { ok: false, reason: "malformed" }
  }

  const expected = await hmacSha256(payloadBytes, secret)
  // `timingSafeEqual` requires equal-length buffers; the byte-length
  // check above gates that. Wrong-length sigs already returned malformed.
  if (!constantTimeEqual(expected, sigBytes)) {
    return { ok: false, reason: "bad-signature" }
  }

  let payload: UploadTokenPayload
  try {
    payload = JSON.parse(textDecoder.decode(payloadBytes)) as UploadTokenPayload
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

async function hmacSha256(
  payload: Uint8Array,
  secret: string
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, bytesToArrayBuffer(payload))
  )
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Invalid base64url")
  }
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let diff = 0
  for (let i = 0; i < left.byteLength; i++) {
    diff |= left[i] ^ right[i]
  }
  return diff === 0
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
