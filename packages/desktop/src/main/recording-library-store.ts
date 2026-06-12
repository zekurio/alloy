import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import type { RecordingCapture } from "@alloy/contracts"
import { logger } from "@alloy/logging"
import { shell } from "electron"

import type {
  RecordingLibraryImportRequest,
  RecordingLibraryImportResult,
  RecordingLibraryMetaPatch,
  RecordingLibraryProject,
  RecordingLibraryProjectDraftSaveRequest,
  RecordingLibraryProjectDraftSaveResult,
} from "@/shared/ipc"

import { probeDurationMs } from "./media"
import {
  correctCaptureDurationMs,
  readCaptureManifest,
  writeCaptureManifest,
  manifestKey,
  type CaptureManifestEntry,
} from "./recording-library-manifest"
import { findRecordingLibraryItem } from "./recording-library-scan"
import { captureId, titleForCapture } from "./recording-library-shared"
import {
  pruneStaleThumbnails,
  warmRecordingThumbnail,
} from "./recording-library-thumbnails"
import { activeSessionIdForGame } from "./recording-session-tracker"
import { currentOutputFolder } from "./recording-storage"

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
    sizeBytes: capture.sizeBytes,
    durationMs: capture.durationMs,
    bookmarksMs: capture.bookmarksMs,
    width: capture.width,
    height: capture.height,
    createdAt: capture.createdAt,
    updatedAt: new Date().toISOString(),
    gameSessionId:
      existing?.gameSessionId ?? activeSessionIdForGame(capture.game),
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
): void {
  const item = findRecordingLibraryItem(patch.id)
  if (!item) throw new Error("Capture not found.")

  const manifest = readCaptureManifest()
  const key = manifestKey(item.filename)
  const entry: CaptureManifestEntry = manifest.captures[key] ?? {
    filename: item.filename,
    title: item.title,
    kind: item.kind,
    source: item.source,
    gameName: item.gameName,
    gameIconUrl: null,
    sizeBytes: item.sizeBytes,
    durationMs: item.durationMs,
    bookmarksMs: item.bookmarksMs,
    width: item.width,
    height: item.height,
    createdAt: item.createdAt,
    updatedAt: new Date().toISOString(),
  }

  if (patch.title !== undefined) entry.title = patch.title
  if (patch.description !== undefined) entry.description = patch.description
  if (patch.tags !== undefined) entry.tags = patch.tags
  if (patch.mentions !== undefined) entry.mentions = patch.mentions
  if (patch.privacy !== undefined) entry.privacy = patch.privacy
  if (patch.uploadedClipId !== undefined) {
    entry.uploadedClipId = patch.uploadedClipId
  }
  entry.updatedAt = new Date().toISOString()

  manifest.captures[key] = entry
  writeCaptureManifest(manifest)
}

export function saveRecordingLibraryProjectDraft(
  request: RecordingLibraryProjectDraftSaveRequest,
): RecordingLibraryProjectDraftSaveResult {
  const manifest = readCaptureManifest()
  const id =
    request.id && manifest.projectDrafts[request.id]
      ? request.id
      : `draft-${randomUUID()}`
  const existing = manifest.projectDrafts[id]
  const now = new Date().toISOString()
  const title = request.title.trim() || "Untitled project"
  const project = request.project

  manifest.projectDrafts[id] = {
    id,
    title,
    project,
    thumbnailSourceId: draftThumbnailSourceId(project),
    durationMs: projectDurationMs(project),
    clipCount: project.clips.length,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  writeCaptureManifest(manifest)
  return { id }
}

export function deleteRecordingLibraryProjectDraft(id: string): void {
  const manifest = readCaptureManifest()
  if (!manifest.projectDrafts[id]) return
  delete manifest.projectDrafts[id]
  writeCaptureManifest(manifest)
}

/**
 * Writes a rendered video (from the editor) into the Clips collection and
 * registers it in the manifest, so the next library scan picks it up like
 * any recorded capture.
 */
export function importRecordingLibraryCapture(
  request: RecordingLibraryImportRequest,
): RecordingLibraryImportResult {
  const root = join(currentOutputFolder(), "Clips")
  mkdirSync(root, { recursive: true })

  const safeBase =
    request.fileName
      .replace(/\.mp4$/i, "")
      .replace(/[^A-Za-z0-9 ._-]/g, "_")
      .trim() || "render"
  let filename = join(root, `${safeBase}.mp4`)
  for (let counter = 2; existsSync(filename); counter++) {
    filename = join(root, `${safeBase}-${counter}.mp4`)
  }
  writeFileSync(filename, Buffer.from(request.data))

  const absolute = resolve(filename)
  const createdAt = new Date().toISOString()
  const manifest = readCaptureManifest()
  manifest.captures[manifestKey(absolute)] = {
    filename: absolute,
    title: `Render ${new Date(createdAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`,
    kind: "replay",
    source: "display",
    gameName: null,
    gameIconUrl: null,
    sizeBytes: request.data.byteLength,
    durationMs: request.durationMs > 0 ? Math.round(request.durationMs) : null,
    bookmarksMs: [],
    width: request.width,
    height: request.height,
    createdAt,
    updatedAt: createdAt,
  }
  writeCaptureManifest(manifest)

  return { id: captureId(absolute) }
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
    if (message)
      logger.warn("[desktop] failed to open library folder:", message)
  })
}

export function openRecordingLibraryItem(id: string): void {
  const item = findRecordingLibraryItem(id)
  if (!item) return

  const openError = shell.openPath(item.filename)
  void openError.then((message) => {
    if (message)
      logger.warn("[desktop] failed to open library capture:", message)
  })
}

export function revealRecordingLibraryItem(id: string): void {
  const item = findRecordingLibraryItem(id)
  if (!item) return

  shell.showItemInFolder(item.filename)
}

function projectDurationMs(project: RecordingLibraryProject): number {
  return project.clips.reduce((max, clip) => {
    const durationMs = Math.max(0, clip.sourceEndMs - clip.sourceStartMs)
    return Math.max(max, clip.startMs + durationMs)
  }, 0)
}

function draftThumbnailSourceId(
  project: RecordingLibraryProject,
): string | null {
  return (
    [...project.clips].sort((a, b) => a.startMs - b.startMs)[0]?.sourceId ??
    null
  )
}
