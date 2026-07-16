import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { constants, mkdirSync, statSync } from "node:fs"
import { copyFile, readdir, rename, stat, unlink } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"

import type {
  RecordingLibraryCommitStagedImportRequest,
  RecordingLibraryFilesImportResult,
  RecordingLibraryImportResult,
  RecordingLibraryStagedImport,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"
import { app } from "electron"

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
import { invalidateRecordingLibrarySnapshot } from "./recording-library-scan"
import {
  captureId,
  titleForCapture,
  VIDEO_EXTENSIONS,
} from "./recording-library-shared"

const logger = createLogger("library")
const STAGED_IMPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface StagedVideoImport {
  id: string
  stagedPath: string
  fileName: string
  extension: string
  title: string
  sizeBytes: number
  durationMs: number | null
  width: number | null
  height: number | null
  createdAt: string
}

const stagedImports = new Map<string, StagedVideoImport>()

export async function stageRecordingLibraryVideoFiles(
  paths: string[],
): Promise<RecordingLibraryFilesImportResult> {
  void cleanupStaleStagedImportFiles()
  const staged: RecordingLibraryStagedImport[] = []
  const failed: { fileName: string; error: string }[] = []

  for (const path of paths) {
    try {
      staged.push(await stageVideoFile(path))
    } catch (cause) {
      logger.warn("failed to stage library import:", cause)
      failed.push({
        fileName: basename(path),
        error: cause instanceof Error ? cause.message : t("Import failed."),
      })
    }
  }

  return { staged, failed, canceled: false }
}

async function stageVideoFile(
  sourcePath: string,
): Promise<RecordingLibraryStagedImport> {
  const source = resolve(sourcePath)
  const extension = extname(source).toLowerCase()
  if (!VIDEO_EXTENSIONS.has(extension)) {
    throw new Error("Not a supported video format.")
  }

  const sourceStat = statSync(source)
  if (!sourceStat.isFile()) throw new Error("This is not a file.")

  const meta = await probeVideoFileMeta(source)
  if (!meta) throw new Error("Couldn't read this file as a video.")

  const id = randomUUID()
  const root = stagedImportFolder()
  mkdirSync(root, { recursive: true })
  const stagedPath = join(root, `${id}${extension}`)
  await copyFile(source, stagedPath, constants.COPYFILE_EXCL)

  const createdAt = new Date(
    sourceStat.mtimeMs > 0 ? sourceStat.mtimeMs : Date.now(),
  ).toISOString()
  const base = basename(source, extension)
  const title = base.trim() || titleForCapture(createdAt)
  const staged: StagedVideoImport = {
    id,
    stagedPath: resolve(stagedPath),
    fileName: basename(source),
    extension,
    title,
    sizeBytes: sourceStat.size,
    durationMs: meta.durationMs,
    width: meta.width,
    height: meta.height,
    createdAt,
  }
  stagedImports.set(id, staged)

  return {
    id,
    fileName: staged.fileName,
    title,
    sizeBytes: staged.sizeBytes,
    durationMs: staged.durationMs,
    width: staged.width,
    height: staged.height,
  }
}

export async function commitRecordingLibraryStagedImport(
  request: RecordingLibraryCommitStagedImportRequest,
): Promise<RecordingLibraryImportResult> {
  const staged = stagedImports.get(request.id)
  if (!staged) throw new Error("Staged import not found.")

  const root = captureCollectionFolder("Clips", request.gameName)
  mkdirSync(root, { recursive: true })
  const safeBase = safeCaptureBase(request.title, { fallback: "import" })
  const destination = uniqueCaptureFilename(root, safeBase, staged.extension)
  await moveFile(staged.stagedPath, destination)

  const absolute = resolve(destination)
  const id = captureId(absolute)
  const manifest = readCaptureManifest()
  manifest.captures[manifestKey(absolute)] = {
    id,
    filename: absolute,
    title: request.title,
    kind: "replay",
    source: "display",
    gameName: request.gameName,
    gameIconUrl: request.gameIconUrl,
    gameGuess: null,
    sizeBytes: staged.sizeBytes,
    durationMs: staged.durationMs,
    width: staged.width,
    height: staged.height,
    createdAt: staged.createdAt,
    updatedAt: new Date().toISOString(),
  }
  writeCaptureManifest(manifest)
  invalidateRecordingLibrarySnapshot()
  stagedImports.delete(request.id)

  return { id }
}

export async function discardRecordingLibraryStagedImport(
  id: string,
): Promise<void> {
  const staged = stagedImports.get(id)
  if (!staged) return
  stagedImports.delete(id)
  try {
    await unlink(staged.stagedPath)
  } catch (cause) {
    logger.warn("failed to discard staged library import:", cause)
  }
}

function stagedImportFolder(): string {
  return join(app.getPath("userData"), "recording-library-imports")
}

function safeCaptureBase(
  value: string,
  { fallback }: { fallback: string },
): string {
  const safe = value.replace(/[^A-Za-z0-9 ._-]/g, "_").trim()
  if (safe.length > 0) return safe
  return fallback
}

async function moveFile(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination)
  } catch (cause) {
    if (!isCrossDeviceError(cause)) throw cause
    await copyFile(source, destination, constants.COPYFILE_EXCL)
    await unlink(source)
  }
}

function isCrossDeviceError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "EXDEV"
  )
}

async function cleanupStaleStagedImportFiles(): Promise<void> {
  const root = stagedImportFolder()
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }

  const activePaths = new Set(
    [...stagedImports.values()].map((staged) => staged.stagedPath),
  )
  const now = Date.now()
  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filename = resolve(root, entry.name)
        if (activePaths.has(filename)) return
        try {
          const info = await stat(filename)
          if (now - info.mtimeMs <= STAGED_IMPORT_MAX_AGE_MS) return
          await unlink(filename)
        } catch (cause) {
          logger.warn("failed to clean up staged library import:", cause)
        }
      }),
  )
}
