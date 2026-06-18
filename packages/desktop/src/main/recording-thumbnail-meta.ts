import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { createLogger } from "@alloy/logging"
import { app } from "electron"

const logger = createLogger("library")

/**
 * Persistent metadata derived from capture thumbnails — today just the
 * BlurHash. Entries are keyed by the same `<captureId>-<mtime>-<size>`
 * signature as the thumbnail files in `recording-thumbnails`, so a hash stays
 * valid across app restarts exactly as long as its thumbnail does, and both
 * invalidate together when the capture file changes.
 */
interface ThumbnailMetaFile {
  version: 1
  blurHashes: Record<string, string>
}

const MAX_ENTRIES = 2000

let cache: ThumbnailMetaFile | null = null

export function getThumbnailBlurHash(signature: string): string | null {
  return readMeta().blurHashes[signature] ?? null
}

export function getThumbnailBlurHashes(): Record<string, string> {
  return { ...readMeta().blurHashes }
}

export function rememberThumbnailBlurHash(
  signature: string,
  blurHash: string,
): void {
  const meta = readMeta()
  if (meta.blurHashes[signature] === blurHash) return
  meta.blurHashes[signature] = blurHash
  compactMeta(meta)
  writeMeta(meta)
}

/** Drops entries for older signatures of the same capture id. */
export function pruneThumbnailBlurHashes(
  captureId: string,
  keepSignature: string,
): void {
  const meta = readMeta()
  let changed = false
  for (const signature of Object.keys(meta.blurHashes)) {
    if (!signature.startsWith(`${captureId}-`)) continue
    if (signature === keepSignature) continue
    delete meta.blurHashes[signature]
    changed = true
  }
  if (changed) writeMeta(meta)
}

/**
 * Caps the store so abandoned captures don't grow it forever. Insertion order
 * approximates age; the oldest entries are evicted first.
 */
function compactMeta(meta: ThumbnailMetaFile): void {
  const signatures = Object.keys(meta.blurHashes)
  if (signatures.length <= MAX_ENTRIES) return
  for (const signature of signatures.slice(
    0,
    signatures.length - MAX_ENTRIES,
  )) {
    delete meta.blurHashes[signature]
  }
}

function readMeta(): ThumbnailMetaFile {
  if (cache) return cache
  try {
    const parsed: unknown = JSON.parse(readFileSync(metaPath(), "utf8"))
    if (isThumbnailMetaFile(parsed)) {
      cache = parsed
      return parsed
    }
  } catch {
    // Missing or corrupt store — start fresh; hashes regenerate lazily.
  }
  cache = { version: 1, blurHashes: {} }
  return cache
}

function writeMeta(meta: ThumbnailMetaFile): void {
  cache = meta
  try {
    const path = metaPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(meta))
  } catch (cause) {
    logger.warn("failed to persist thumbnail metadata:", cause)
  }
}

function metaPath(): string {
  return join(app.getPath("userData"), "recording-thumbnails", "meta.json")
}

function isThumbnailMetaFile(value: unknown): value is ThumbnailMetaFile {
  if (typeof value !== "object" || value === null) return false
  const meta = value as Record<string, unknown>
  if (meta.version !== 1) return false
  if (typeof meta.blurHashes !== "object" || meta.blurHashes === null) {
    return false
  }
  return Object.values(meta.blurHashes).every(
    (hash) => typeof hash === "string",
  )
}
