import type { AcceptedContentType, UploadTicket } from "@workspace/contracts"
import { logger } from "@workspace/logging"

import { configStore } from "../config/store"
import { env } from "../env"
import { dirname, join, relative, resolve } from "../runtime/path"
import { mintFsUploadTicket } from "../storage/fs-upload-token"

export function clipScratchUploadKey(
  clipId: string,
  contentType: AcceptedContentType,
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
  return mintFsUploadTicket({
    payload: {
      k: input.key,
      ct: input.contentType,
      mb: input.maxBytes,
      exp: expiresAt,
      uid: input.userId,
      cid: input.clipId,
    },
    publicBaseUrl: env.PUBLIC_SERVER_URL,
    secret: configStore.get("storage").fs.hmacSecret,
  })
}

export async function deleteScratchUpload(key: string | null): Promise<void> {
  if (!key) return
  const root = scratchRoot()
  const path = scratchUploadPath(key)
  await Deno.remove(path).catch((err) => {
    if (!(err instanceof Deno.errors.NotFound)) throw err
  })
  await removeEmptyScratchParents(dirname(path), root)
}

export async function deleteScratchUploads(
  keys: Iterable<string | null>,
  label: string,
): Promise<void> {
  await Promise.all(
    Array.from(keys, async (key) => {
      if (!key) return
      try {
        await deleteScratchUpload(key)
      } catch (err) {
        logger.warn(`[scratch] failed to delete ${label} ${key}:`, err)
      }
    }),
  )
}

export async function ensureScratchParent(key: string): Promise<string> {
  const path = scratchUploadPath(key)
  await Deno.mkdir(dirname(path), { recursive: true })
  return path
}

function scratchRoot(): string {
  return resolve(
    env.ENCODE_SCRATCH_DIR ?? join(Deno.cwd(), "data", "server", "scratch"),
    "uploads",
  )
}

async function removeEmptyScratchParents(
  startPath: string,
  root: string,
): Promise<void> {
  let path = startPath
  while (path !== root) {
    const rel = relative(root, path)
    if (rel.startsWith("..") || rel.startsWith("/") || rel === "") return
    try {
      await Deno.remove(path)
    } catch (err) {
      if (
        err instanceof Deno.errors.NotFound ||
        isDirectoryNotEmptyError(err)
      ) {
        return
      }
      throw err
    }
    path = dirname(path)
  }
}

function isDirectoryNotEmptyError(err: unknown): boolean {
  return err instanceof Error &&
    (err.name === "DirectoryNotEmpty" || err.name === "NotEmpty")
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
