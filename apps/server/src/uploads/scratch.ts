import type { AcceptedContentType, UploadTicket } from "@workspace/contracts"

import { configStore } from "../config/store"
import { env } from "../env"
import { dirname, join, relative, resolve } from "../runtime/path"
import { signToken } from "../storage/fs-driver"

const Deno = globalThis.Deno

export function clipScratchUploadKey(
  clipId: string,
  contentType: AcceptedContentType
): string {
  return `clip-uploads/${clipId}/source${sourceExtension(contentType)}`
}

export function scratchUploadPath(key: string): string {
  const root = scratchRoot()
  const target = resolve(root, key)
  const rel = relative(root, target)
  if (rel.startsWith("..") || rel.startsWith("/") || rel === "") {
    throw new Error("Scratch upload key escapes scratch root")
  }
  return target
}

export async function mintScratchUploadUrl(input: {
  key: string
  contentType: string
  maxBytes: number
  expiresInSec: number
  userId: string
  clipId: string
}): Promise<UploadTicket> {
  const expiresAt = Math.floor(Date.now() / 1000) + input.expiresInSec
  const token = await signToken(
    {
      k: input.key,
      ct: input.contentType,
      mb: input.maxBytes,
      exp: expiresAt,
      uid: input.userId,
      cid: input.clipId,
    },
    configStore.get("storage").fs.hmacSecret
  )
  const baseUrl = env.PUBLIC_SERVER_URL.replace(/\/+$/, "")
  return {
    uploadUrl: `${baseUrl}/api/assets/upload/${token}`,
    method: "POST",
    headers: { "Content-Type": input.contentType },
    expiresAt,
  }
}

export async function deleteScratchUpload(key: string | null): Promise<void> {
  if (!key) return
  await Deno.remove(scratchUploadPath(key)).catch((err) => {
    if (!(err instanceof Deno.errors.NotFound)) throw err
  })
}

export async function ensureScratchParent(key: string): Promise<string> {
  const path = scratchUploadPath(key)
  await Deno.mkdir(dirname(path), { recursive: true })
  return path
}

function scratchRoot(): string {
  return resolve(
    env.ENCODE_SCRATCH_DIR ?? join(Deno.cwd(), "data", "scratch"),
    "uploads"
  )
}

function sourceExtension(contentType: AcceptedContentType): string {
  switch (contentType) {
    case "video/mp4":
      return ".mp4"
    case "video/quicktime":
      return ".mov"
    case "video/x-matroska":
      return ".mkv"
    case "video/webm":
      return ".webm"
  }
}
