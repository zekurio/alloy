import { randomUUID } from "node:crypto"
import {
  constants,
  renameSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { copyFile } from "node:fs/promises"
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"

import type { RecordingCapture } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { shell } from "electron"

import type {
  RecordingLibraryFilesImportResult,
  RecordingLibraryImportRequest,
  RecordingLibraryImportResult,
  RecordingLibraryItem,
  RecordingLibraryMetaPatch,
  RecordingLibraryMetaUpdateResult,
  RecordingLibraryProject,
  RecordingLibraryProjectDraftSaveRequest,
  RecordingLibraryProjectDraftSaveResult,
} from "@/shared/ipc"

import { probeDurationMs, probeVideoFileMeta } from "./media"
import {
  correctCaptureDurationMs,
  readCaptureManifest,
  writeCaptureManifest,
  manifestKey,
  type CaptureManifestEntry,
} from "./recording-library-manifest"
import { findRecordingLibraryItem } from "./recording-library-scan"
import {
  captureId,
  titleForCapture,
  VIDEO_EXTENSIONS,
} from "./recording-library-shared"
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
  const root = captureCollectionFolder("Clips", null)
  mkdirSync(root, { recursive: true })

  const safeBase =
    request.fileName
      .replace(/\.mp4$/i, "")
      .replace(/[^A-Za-z0-9 ._-]/g, "_")
      .trim() || "render"
  const filename = uniqueCaptureFilename(root, safeBase, ".mp4")
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
 * Copies user-picked video files into the Clips collection and registers them
 * in the manifest, so footage from other recorders (or downloads) shows up in
 * the library like any recorded capture. Files that fail are reported back
 * per-file instead of aborting the batch.
 */
export async function importRecordingLibraryVideoFiles(
  paths: string[],
): Promise<RecordingLibraryFilesImportResult> {
  const importedIds: string[] = []
  const failed: { fileName: string; error: string }[] = []

  for (const path of paths) {
    try {
      importedIds.push(await importVideoFile(path))
    } catch (cause) {
      logger.warn("failed to import library file:", cause)
      failed.push({
        fileName: basename(path),
        error: cause instanceof Error ? cause.message : "Import failed.",
      })
    }
  }

  return { importedIds, failed, canceled: false }
}

async function importVideoFile(sourcePath: string): Promise<string> {
  const source = resolve(sourcePath)
  const extension = extname(source).toLowerCase()
  if (!VIDEO_EXTENSIONS.has(extension)) {
    throw new Error("Not a supported video format.")
  }

  // Files already inside a scanned collection are in the library as-is;
  // copying them again would only create a duplicate card.
  if (isInsideVideoCollection(source)) return captureId(source)

  const sourceStat = statSync(source)
  const meta = await probeVideoFileMeta(source)
  if (!meta) throw new Error("Couldn't read this file as a video.")

  const root = captureCollectionFolder("Clips", null)
  mkdirSync(root, { recursive: true })
  const base = basename(source, extension)
  const safeBase = base.replace(/[^A-Za-z0-9 ._-]/g, "_").trim() || "import"
  const destination = uniqueCaptureFilename(root, safeBase, extension)
  await copyFile(source, destination, constants.COPYFILE_EXCL)

  const absolute = resolve(destination)
  // The source's modified time survives copies and downloads, so it's the
  // closest thing to "when this was actually recorded".
  const createdAt = new Date(
    sourceStat.mtimeMs > 0 ? sourceStat.mtimeMs : Date.now(),
  ).toISOString()
  const manifest = readCaptureManifest()
  manifest.captures[manifestKey(absolute)] = {
    filename: absolute,
    title: base.trim() || titleForCapture("replay", createdAt),
    kind: "replay",
    source: "display",
    gameName: null,
    gameIconUrl: null,
    sizeBytes: sourceStat.size,
    durationMs: meta.durationMs,
    bookmarksMs: [],
    width: meta.width,
    height: meta.height,
    createdAt,
    updatedAt: new Date().toISOString(),
  }
  writeCaptureManifest(manifest)

  return captureId(absolute)
}

/** Whether a file already lives under a scanned video collection root. */
function isInsideVideoCollection(filename: string): boolean {
  const outputFolder = currentOutputFolder()
  return ["Clips", "Sessions"].some((collection) => {
    const rel = relative(join(outputFolder, collection), filename)
    return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel)
  })
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

function captureCollectionFolder(
  collection: "Clips" | "Sessions",
  gameName: string | null,
): string {
  return join(
    currentOutputFolder(),
    collection,
    fileComponent(gameName, "Desktop"),
  )
}

function fileComponent(value: string | null, fallback: string): string {
  let component = ""
  let previousWasSeparator = false

  for (const char of value?.trim() ?? "") {
    const replacement = isUnsafePathCharacter(char) ? "-" : char
    const isWhitespace = /\s/.test(replacement)
    if (replacement === "-" || isWhitespace) {
      if (!previousWasSeparator && component.length > 0) {
        component += isWhitespace ? " " : "-"
        previousWasSeparator = true
      }
      continue
    }

    component += replacement
    previousWasSeparator = false
  }

  component = component.replace(/^[ .-]+|[ .-]+$/g, "")
  return component.length > 0 && !isReservedWindowsName(component)
    ? component
    : fallback
}

function isUnsafePathCharacter(value: string): boolean {
  const code = value.charCodeAt(0)
  return (
    code < 32 ||
    code === 127 ||
    value === "<" ||
    value === ">" ||
    value === ":" ||
    value === '"' ||
    value === "/" ||
    value === "\\" ||
    value === "|" ||
    value === "?" ||
    value === "*"
  )
}

function isReservedWindowsName(value: string): boolean {
  const base = value.split(".")[0]?.toUpperCase()
  return (
    base === "CON" ||
    base === "PRN" ||
    base === "AUX" ||
    base === "NUL" ||
    /^COM[1-9]$/.test(base ?? "") ||
    /^LPT[1-9]$/.test(base ?? "")
  )
}

/** Returns a collision-free path in `root` for an already-sanitized base. */
function uniqueCaptureFilename(
  root: string,
  base: string,
  extension: string,
): string {
  let filename = join(root, `${base}${extension}`)
  for (let counter = 2; existsSync(filename); counter++) {
    filename = join(root, `${base}-${counter}${extension}`)
  }
  return filename
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
