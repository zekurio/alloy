import { renameSync, mkdirSync } from "node:fs"
import { basename, extname, resolve } from "node:path"

import type { RecordingCapture } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { shell } from "electron"

import type {
  RecordingLibraryItem,
  RecordingLibraryMetaPatch,
  RecordingLibraryMetaUpdateResult,
} from "@/shared/ipc"

import { probeDurationMs } from "./media"
import {
  correctCaptureDurationMs,
  readCaptureManifest,
  writeCaptureManifest,
  manifestKey,
  type CaptureManifestEntry,
} from "./recording-library-manifest"
import {
  captureCollectionFolder,
  uniqueCaptureFilename,
} from "./recording-library-paths"
import { findRecordingLibraryItem } from "./recording-library-scan"
import { captureId, titleForCapture } from "./recording-library-shared"
import {
  pruneStaleThumbnails,
  warmRecordingThumbnail,
} from "./recording-library-thumbnails"
import { currentOutputFolder } from "./recording-storage"

const logger = createLogger("library")

export function rememberRecordingLibraryCapture(
  capture: RecordingCapture,
): void {
  const filename = resolve(capture.filename)
  const manifest = readCaptureManifest()
  const existing = manifest.captures[manifestKey(filename)]
  manifest.captures[manifestKey(filename)] = {
    ...existing,
    filename,
    title: titleForCapture(capture.kind, capture.createdAt),
    kind: capture.kind,
    source: capture.source,
    gameName: capture.game?.name ?? null,
    gameIconUrl: capture.game?.iconUrl ?? null,
    gameGuess: capture.game?.guess ?? null,
    sizeBytes: capture.sizeBytes,
    durationMs: capture.durationMs,
    bookmarksMs: capture.bookmarksMs,
    width: capture.width,
    height: capture.height,
    createdAt: capture.createdAt,
    updatedAt: new Date().toISOString(),
  }
  writeCaptureManifest(manifest)
  warmRecordingThumbnail(capture)

  // The sidecar reports the requested duration (for replays, the configured
  // buffer window even when the buffer held less footage). Measure the real
  // duration off the recording path and correct the entry when they disagree.
  void probeDurationMs(filename).then((probed) => {
    if (probed === null) return
    const reported = capture.durationMs
    if (reported !== null && Math.abs(probed - reported) <= 1000) return
    correctCaptureDurationMs(filename, probed)
  })
}

/**
 * Persists user-edited upload metadata (title, description, tags, mentions,
 * privacy) for a capture so drafts survive app restarts. Creates a manifest
 * entry on demand for captures that were scanned from disk rather than
 * recorded through the app.
 */
export function updateRecordingLibraryCaptureMeta(
  patch: RecordingLibraryMetaPatch,
): RecordingLibraryMetaUpdateResult {
  const item = findRecordingLibraryItem(patch.id)
  if (!item) throw new Error("Capture not found.")

  const manifest = readCaptureManifest()
  let key = manifestKey(item.filename)
  const entry: CaptureManifestEntry = manifest.captures[key] ?? {
    filename: item.filename,
    title: item.title,
    kind: item.kind,
    source: item.source,
    gameName: item.gameName,
    gameIconUrl: null,
    gameGuess: item.gameGuess,
    sizeBytes: item.sizeBytes,
    durationMs: item.durationMs,
    bookmarksMs: item.bookmarksMs,
    width: item.width,
    height: item.height,
    createdAt: item.createdAt,
    updatedAt: new Date().toISOString(),
  }

  if (patch.title !== undefined) entry.title = patch.title
  if (patch.gameName !== undefined) entry.gameName = patch.gameName
  if (patch.gameIconUrl !== undefined) entry.gameIconUrl = patch.gameIconUrl
  if (patch.gameGuess !== undefined) entry.gameGuess = patch.gameGuess
  if (patch.description !== undefined) entry.description = patch.description
  if (patch.tags !== undefined) entry.tags = patch.tags
  if (patch.mentions !== undefined) entry.mentions = patch.mentions
  if (patch.privacy !== undefined) entry.privacy = patch.privacy
  if (patch.uploadedClipId !== undefined) {
    entry.uploadedClipId = patch.uploadedClipId
  }
  entry.updatedAt = new Date().toISOString()

  if (patch.gameName !== undefined) {
    const moved = moveDisplayCaptureToGameFolder(item, entry)
    if (moved) {
      delete manifest.captures[key]
      key = manifestKey(moved)
    }
  }

  manifest.captures[key] = entry
  writeCaptureManifest(manifest)
  return { id: captureId(entry.filename) }
}

function moveDisplayCaptureToGameFolder(
  item: RecordingLibraryItem,
  entry: CaptureManifestEntry,
): string | null {
  if (item.source !== "display") return null
  if (item.collection !== "Clips" && item.collection !== "Sessions") {
    return null
  }

  const root = captureCollectionFolder(item.collection, entry.gameName)
  const current = resolve(entry.filename)
  if (resolve(current, "..") === resolve(root)) return null

  mkdirSync(root, { recursive: true })
  const extension = extname(current)
  const base = basename(current, extension)
  const destination = uniqueCaptureFilename(root, base, extension)
  renameSync(current, destination)
  entry.filename = resolve(destination)
  return entry.filename
}

/**
 * Moves a capture's file to the OS trash and forgets its manifest entry and
 * cached thumbnails. Trashing (not unlinking) keeps the delete hotkey
 * recoverable.
 */
export async function deleteRecordingLibraryItem(id: string): Promise<void> {
  const item = findRecordingLibraryItem(id)
  if (!item) throw new Error("Capture not found.")

  await shell.trashItem(item.filename)

  const manifest = readCaptureManifest()
  if (manifest.captures[manifestKey(item.filename)]) {
    delete manifest.captures[manifestKey(item.filename)]
    writeCaptureManifest(manifest)
  }
  // Passing an impossible "keep" name clears every cached file for the id.
  pruneStaleThumbnails(id, "")
}

export function openRecordingLibraryFolder(): void {
  const folder = currentOutputFolder()
  const openError = shell.openPath(folder)
  void openError.then((message) => {
    if (message) logger.warn("failed to open library folder:", message)
  })
}

export function openRecordingLibraryItem(id: string): void {
  const item = findRecordingLibraryItem(id)
  if (!item) return

  const openError = shell.openPath(item.filename)
  void openError.then((message) => {
    if (message) logger.warn("failed to open library capture:", message)
  })
}

export function revealRecordingLibraryItem(id: string): void {
  const item = findRecordingLibraryItem(id)
  if (!item) return

  shell.showItemInFolder(item.filename)
}
