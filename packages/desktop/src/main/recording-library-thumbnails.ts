import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  type Dirent,
  type Stats,
} from "node:fs"
import { dirname, extname, join, resolve } from "node:path"

import type { RecordingCapture } from "@alloy/contracts"
import { logger } from "@alloy/logging"
import { app } from "electron"

import type { RecordingLibraryItem } from "@/shared/ipc"

import { runFfmpeg, runFfprobe } from "./ffmpeg"
import { imageFileBlurHash } from "./image-blurhash"
import {
  captureId,
  thumbnailSignature,
  VIDEO_EXTENSIONS,
} from "./recording-library-shared"
import {
  getThumbnailBlurHash,
  pruneThumbnailBlurHashes,
  rememberThumbnailBlurHash,
} from "./recording-thumbnail-meta"

const pendingThumbnails = new Map<string, Promise<string | null>>()

export type ThumbnailSource = Pick<
  RecordingLibraryItem,
  "id" | "kind" | "filename"
>

export async function ensureRecordingThumbnail(
  item: ThumbnailSource,
): Promise<string | null> {
  if (item.kind === "screenshot") return item.filename
  if (!VIDEO_EXTENSIONS.has(extname(item.filename).toLowerCase())) return null

  let stat: Stats
  try {
    stat = statSync(item.filename)
  } catch {
    return null
  }

  const out = thumbnailPath(item.id, stat)
  if (existsSync(out)) return out

  // Concurrent protocol requests for the same capture (grid + editor poster)
  // must share one ffmpeg run instead of racing on the output file.
  const pending = pendingThumbnails.get(out)
  if (pending) return pending

  const task = generateRecordingThumbnail(item, out).finally(() => {
    pendingThumbnails.delete(out)
  })
  pendingThumbnails.set(out, task)
  return task
}

async function generateRecordingThumbnail(
  item: ThumbnailSource,
  out: string,
): Promise<string | null> {
  try {
    mkdirSync(dirname(out), { recursive: true })
    pruneStaleThumbnails(item.id, out)

    // `thumbnail=n=…` scans a window of decoded frames and keeps the most
    // representative one, so fade-ins and black lead frames don't become the
    // poster. Seek past the first second when the clip is long enough.
    const attempts: string[][] = [
      ["-ss", "1", "-i", item.filename],
      ["-i", item.filename],
    ]
    for (const input of attempts) {
      try {
        await runFfmpeg(
          [
            "-y",
            ...input,
            "-frames:v",
            "1",
            "-vf",
            "thumbnail=n=24,scale=640:-2",
            "-q:v",
            "4",
            out,
          ],
          { timeout: 20_000 },
        )
      } catch (cause) {
        logger.warn("[desktop] recording thumbnail pass failed:", cause)
        continue
      }
      if (existsSync(out) && statSync(out).size > 0) return out
    }
    return null
  } catch (cause) {
    logger.warn("[desktop] failed to generate recording thumbnail:", cause)
    return null
  }
}

export async function probeDurationMs(
  filename: string,
): Promise<number | null> {
  try {
    const stdout = await runFfprobe(
      ["-show_entries", "format=duration", "-of", "csv=p=0", filename],
      { timeout: 30_000 },
    )
    const seconds = Number.parseFloat(stdout.trim())
    return Number.isFinite(seconds) && seconds > 0
      ? Math.round(seconds * 1000)
      : null
  } catch {
    return null
  }
}

/**
 * Filmstrip frames now decode in the renderer (mediabunny); drop the on-disk
 * cache older app versions rendered with ffmpeg.
 */
export function cleanupLegacyFilmstripCache(): void {
  try {
    rmSync(join(app.getPath("userData"), "recording-filmstrips"), {
      recursive: true,
      force: true,
    })
  } catch {
    // Best effort — a locked folder just lingers.
  }
}

/** Drops thumbnails generated from an older mtime/size of the same capture. */
export function pruneStaleThumbnails(id: string, keep: string): void {
  const folder = thumbnailFolder()
  let entries: Dirent[]
  try {
    entries = readdirSync(folder, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.startsWith(`${id}-`)) continue
    const path = join(folder, entry.name)
    if (path === keep) continue
    try {
      rmSync(path, { force: true })
    } catch {
      // Best effort — a locked stale file just lingers until the next pass.
    }
  }
}

/**
 * Generates the thumbnail and BlurHash in the background as soon as a capture
 * lands, so the library grid shows real frames (or at least a blurred
 * placeholder) on first paint.
 */
export function warmRecordingThumbnail(capture: RecordingCapture): void {
  const filename = resolve(capture.filename)
  void ensureCaptureBlurHash({
    id: captureId(filename),
    kind: capture.kind,
    filename,
  })
}

/**
 * Computes (and persists) the BlurHash for a capture from its thumbnail —
 * or from the image itself for screenshots. Hashes are keyed by the same
 * mtime/size signature as thumbnail files, so they stay stable across app
 * starts and invalidate together with the thumbnail when the file changes.
 */
export async function ensureCaptureBlurHash(
  item: ThumbnailSource,
): Promise<string | null> {
  let stat: Stats
  try {
    stat = statSync(item.filename)
  } catch {
    return null
  }

  const signature = thumbnailSignature(item.id, stat)
  const existing = getThumbnailBlurHash(signature)
  if (existing) return existing

  const imagePath =
    item.kind === "screenshot"
      ? item.filename
      : await ensureRecordingThumbnail(item)
  if (!imagePath) return null

  const blurHash = imageFileBlurHash(imagePath)
  if (blurHash) {
    rememberThumbnailBlurHash(signature, blurHash)
    pruneThumbnailBlurHashes(item.id, signature)
  }
  return blurHash
}

function thumbnailPath(id: string, stat: Stats): string {
  return join(thumbnailFolder(), `${thumbnailSignature(id, stat)}.jpg`)
}

function thumbnailFolder(): string {
  return join(app.getPath("userData"), "recording-thumbnails")
}
