import { constants, mkdirSync, statSync, writeFileSync } from "node:fs"
import { copyFile } from "node:fs/promises"
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"

import { createLogger } from "@alloy/logging"

import type {
  RecordingLibraryFilesImportResult,
  RecordingLibraryImportRequest,
  RecordingLibraryImportResult,
} from "@/shared/ipc"

import { probeVideoFileMeta } from "./media"
import {
  readCaptureManifest,
  writeCaptureManifest,
  manifestKey,
} from "./recording-library-manifest"
import {
  captureCollectionFolder,
  uniqueCaptureFilename,
} from "./recording-library-paths"
import {
  captureId,
  titleForCapture,
  VIDEO_EXTENSIONS,
} from "./recording-library-shared"
import { currentOutputFolder } from "./recording-storage"

const logger = createLogger("library")

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
  const id = captureId(absolute)
  const createdAt = new Date().toISOString()
  const manifest = readCaptureManifest()
  manifest.captures[manifestKey(absolute)] = {
    id,
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
    gameGuess: null,
    sizeBytes: request.data.byteLength,
    durationMs: request.durationMs > 0 ? Math.round(request.durationMs) : null,
    bookmarksMs: [],
    width: request.width,
    height: request.height,
    createdAt,
    updatedAt: createdAt,
  }
  writeCaptureManifest(manifest)

  return { id }
}

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
  const id = captureId(absolute)
  const createdAt = new Date(
    sourceStat.mtimeMs > 0 ? sourceStat.mtimeMs : Date.now(),
  ).toISOString()
  const manifest = readCaptureManifest()
  manifest.captures[manifestKey(absolute)] = {
    id,
    filename: absolute,
    title: base.trim() || titleForCapture("replay", createdAt),
    kind: "replay",
    source: "display",
    gameName: null,
    gameIconUrl: null,
    gameGuess: null,
    sizeBytes: sourceStat.size,
    durationMs: meta.durationMs,
    bookmarksMs: [],
    width: meta.width,
    height: meta.height,
    createdAt,
    updatedAt: new Date().toISOString(),
  }
  writeCaptureManifest(manifest)

  return id
}

function isInsideVideoCollection(filename: string): boolean {
  const outputFolder = currentOutputFolder()
  return ["Clips", "Sessions"].some((collection) => {
    const rel = relative(join(outputFolder, collection), filename)
    return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel)
  })
}
