import { type ClipRow, clipDownloadUrl } from "@alloy/api"
import { useSyncExternalStore } from "react"

import { clientLogger } from "@/lib/client-log"
import {
  alloyDesktop,
  notifyLibraryCapturesChanged,
  type RecordingLibraryDownload,
} from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"

/**
 * Shared renderer-side view of the desktop shell's clip downloads (uploaded
 * clips being persisted back into the local capture library). The shell owns
 * the state; this module hydrates once from `listClipDownloads` and then
 * follows "library-download" recording events, so every surface (sync
 * tracker, library cards, editor media panel) sees the same progress.
 */

const downloads = new Map<string, RecordingLibraryDownload>()
let snapshot: RecordingLibraryDownload[] = []
const listeners = new Set<() => void>()
let started = false

/** True when the desktop shell is new enough to persist clips locally. */
export function clipDownloadsSupported(): boolean {
  const desktop = alloyDesktop()
  return typeof desktop?.recording.downloadClip === "function"
}

function emit(): void {
  snapshot = [...downloads.values()]
  for (const listener of listeners) listener()
}

function applyDownload(download: RecordingLibraryDownload): void {
  const previous = downloads.get(download.clipId)
  downloads.set(download.clipId, download)
  // The library gained a file on disk: poke snapshot consumers to re-scan.
  if (download.status === "completed" && previous?.status !== "completed") {
    notifyLibraryCapturesChanged()
  }
  emit()
}

function ensureStarted(): void {
  if (started) return
  started = true
  const desktop = alloyDesktop()
  if (!clipDownloadsSupported() || !desktop) return

  desktop.recording.onEvent((event) => {
    if (event.type === "library-download") applyDownload(event.download)
  })
  void desktop.recording
    .listClipDownloads()
    .then((list) => {
      // Events that raced ahead of the hydration snapshot are fresher.
      for (const download of list) {
        if (!downloads.has(download.clipId)) {
          downloads.set(download.clipId, download)
        }
      }
      emit()
    })
    .catch((cause) => {
      clientLogger.warn("[downloads] Failed to list clip downloads.", cause)
    })
}

function subscribe(listener: () => void): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Every known download (active and finished-but-undismissed). */
export function useClipDownloads(): RecordingLibraryDownload[] {
  return useSyncExternalStore(subscribe, () => snapshot)
}

/** State of one clip's download, or null when none is known. */
export function useClipDownload(
  clipId: string,
): RecordingLibraryDownload | null {
  const all = useClipDownloads()
  return all.find((download) => download.clipId === clipId) ?? null
}

/**
 * Asks the desktop shell to persist an uploaded clip into the local library.
 * Resolves once the download has been registered; progress flows through the
 * store. Throws when the shell rejects the request.
 */
export async function startClipDownload(row: ClipRow): Promise<void> {
  const desktop = alloyDesktop()
  if (!desktop || !clipDownloadsSupported()) {
    throw new Error("Clip downloads need the Alloy desktop app.")
  }
  ensureStarted()
  const accepted = await desktop.recording.downloadClip({
    clipId: row.id,
    title: row.title,
    // The download endpoint serves the original source, matching the
    // contentType/sizeBytes declared below; /stream serves the top rendition.
    mediaUrl: clipDownloadUrl(row.id, apiOrigin()),
    contentType: row.sourceContentType,
    sizeBytes: row.sourceSizeBytes,
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    gameName: row.gameRef?.name ?? row.game,
  })
  applyDownload(accepted)
}

/** Aborts an in-flight download, or dismisses a finished row. */
export function removeClipDownload(clipId: string): void {
  downloads.delete(clipId)
  emit()
  void alloyDesktop()
    ?.recording.cancelClipDownload(clipId)
    .catch((cause) => {
      clientLogger.warn(
        `[downloads] Failed to cancel download for clip ${clipId}.`,
        cause,
      )
    })
}
