import { createWriteStream, mkdirSync, rmSync } from "node:fs"
import { rename } from "node:fs/promises"
import { resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import type {
  RecordingLibraryDownload,
  RecordingLibraryDownloadRequest,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"

import { probeDurationMs } from "./media"
import { emitRecordingLibraryDownloadEvent } from "./recording"
import {
  correctCaptureDurationMs,
  manifestKey,
  readCaptureManifest,
  writeCaptureManifest,
} from "./recording-library-manifest"
import {
  captureCollectionFolder,
  uniqueCaptureFilename,
} from "./recording-library-paths"
import { captureId } from "./recording-library-shared"
import { mainSession } from "./session"

const logger = createLogger("library")

/**
 * Downloads of uploaded clips back into the local capture library. One job
 * per clip id; finished (completed/failed) entries stay listed until the
 * renderer dismisses them, so the sync tracker survives page reloads.
 */

interface DownloadJob {
  download: RecordingLibraryDownload
  abort: AbortController | null
}

const jobs = new Map<string, DownloadJob>()

/** Don't flood the renderer: progress events at most every 200ms. */
const PROGRESS_EMIT_INTERVAL_MS = 200

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/x-matroska": ".mkv",
  "video/webm": ".webm",
}

export function listRecordingLibraryClipDownloads(): RecordingLibraryDownload[] {
  return [...jobs.values()].map((job) => ({ ...job.download }))
}

/**
 * Aborts an in-flight download, or forgets a finished one. Either way the
 * clip id disappears from the download list; an aborted job also deletes its
 * partial file.
 */
export function cancelRecordingLibraryClipDownload(clipId: string): void {
  const job = jobs.get(clipId)
  if (!job) return
  job.abort?.abort()
  jobs.delete(clipId)
}

/**
 * Starts persisting an uploaded clip into the library's Clips folder. The
 * fetch runs with the main partition's cookies, so it reuses the signed-in
 * session. Returns the job's current snapshot immediately; progress and the
 * terminal state stream out as "library-download" recording events.
 */
export function startRecordingLibraryClipDownload(
  request: RecordingLibraryDownloadRequest,
): RecordingLibraryDownload {
  const existing = jobs.get(request.clipId)
  if (existing && existing.download.status === "downloading") {
    return { ...existing.download }
  }

  const download: RecordingLibraryDownload = {
    clipId: request.clipId,
    title: request.title,
    status: "downloading",
    receivedBytes: 0,
    totalBytes: request.sizeBytes,
    error: null,
    libraryItemId: null,
    startedAt: new Date().toISOString(),
  }
  const job: DownloadJob = { download, abort: new AbortController() }
  jobs.set(request.clipId, job)
  emitRecordingLibraryDownloadEvent({ ...download })

  void runDownload(request, job).catch((cause) => {
    logger.warn(`clip download crashed for ${request.clipId}:`, cause)
  })

  return { ...download }
}

async function runDownload(
  request: RecordingLibraryDownloadRequest,
  job: DownloadJob,
): Promise<void> {
  const signal = job.abort?.signal
  const root = captureCollectionFolder("Clips", request.gameName)
  let partialFile: string | null = null
  try {
    mkdirSync(root, { recursive: true })
    const filename = uniqueTargetFile(root, request)
    partialFile = `${filename}.part`

    const response = await mainSession().fetch(request.mediaUrl, {
      credentials: "include",
      signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`The server answered ${response.status}.`)
    }

    const contentLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > 0) {
      job.download.totalBytes = contentLength
    }

    let lastEmitAt = 0
    const source = Readable.fromWeb(
      response.body as import("node:stream/web").ReadableStream,
    )
    source.on("data", (chunk: Buffer) => {
      job.download.receivedBytes += chunk.byteLength
      const now = Date.now()
      if (now - lastEmitAt >= PROGRESS_EMIT_INTERVAL_MS) {
        lastEmitAt = now
        emitRecordingLibraryDownloadEvent({ ...job.download })
      }
    })
    await pipeline(source, createWriteStream(partialFile), { signal })

    await rename(partialFile, filename)
    partialFile = null

    const absolute = resolve(filename)
    const id = registerDownloadedCapture(
      absolute,
      request,
      job.download.receivedBytes,
    )
    job.download.status = "completed"
    job.download.libraryItemId = id
    emitRecordingLibraryDownloadEvent({ ...job.download })

    // Uploaded clips carry their duration, but probe when it's missing so the
    // editor timeline gets a real value (mirrors recorded captures).
    if (request.durationMs === null) {
      void probeDurationMs(absolute).then((probed) => {
        if (probed !== null) correctCaptureDurationMs(absolute, probed)
      })
    }
  } catch (cause) {
    if (partialFile) {
      try {
        rmSync(partialFile, { force: true })
      } catch {
        // Leaving a stray .part file behind is harmless; the scan skips it.
      }
    }
    // A cancelled job was already removed from the registry — stay silent.
    if (signal?.aborted || !jobs.has(request.clipId)) return
    job.download.status = "failed"
    job.download.error =
      cause instanceof Error ? cause.message : t("Download failed.")
    emitRecordingLibraryDownloadEvent({ ...job.download })
  } finally {
    job.abort = null
  }
}

function uniqueTargetFile(
  root: string,
  request: RecordingLibraryDownloadRequest,
): string {
  const extension =
    EXTENSION_BY_CONTENT_TYPE[request.contentType ?? ""] ?? ".mp4"
  const safeBase =
    request.title.replace(/[^A-Za-z0-9 ._-]/g, "_").trim() || "clip"
  return uniqueCaptureFilename(root, safeBase, extension)
}

/**
 * Registers the saved file in the capture manifest with `uploadedClipId`
 * pointing back at the server clip, so the library and editor collapse the
 * local/cloud pair into one entry backed by the file on disk.
 */
function registerDownloadedCapture(
  absolute: string,
  request: RecordingLibraryDownloadRequest,
  sizeBytes: number,
): string {
  const now = new Date().toISOString()
  const id = captureId(absolute)
  const manifest = readCaptureManifest()
  manifest.captures[manifestKey(absolute)] = {
    id,
    filename: absolute,
    title: request.title,
    kind: "replay",
    source: "display",
    gameName: request.gameName,
    gameIconUrl: null,
    gameGuess: null,
    sizeBytes,
    durationMs:
      request.durationMs !== null && request.durationMs > 0
        ? Math.round(request.durationMs)
        : null,
    width: request.width,
    height: request.height,
    createdAt: now,
    updatedAt: now,
    uploadedClipId: request.clipId,
  }
  writeCaptureManifest(manifest)
  return id
}
