import { mkdirSync, readdirSync, statfsSync, statSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

import type { RecordingStorageInfo } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app } from "electron"

import { getRecordingSettings } from "./server-store"

const logger = createLogger("recording")

const GB = 1_000_000_000

/** Default capture folder when the user hasn't picked one. */
export function defaultOutputFolder(): string {
  return join(app.getPath("videos"), "Alloy")
}

export function defaultScreenshotFolder(): string {
  return join(app.getPath("pictures"), "Alloy")
}

export function defaultReplayScratchFolder(): string {
  return join(app.getPath("temp"), "Alloy", "replay-buffer")
}

export async function getRecordingStorageInfo(): Promise<RecordingStorageInfo> {
  const outputFolder = currentOutputFolder()
  ensureFolder(outputFolder)

  const fsInfo = readFilesystemInfo(outputFolder)
  const clipsBytes = sumCaptureBytes(outputFolder)
  return {
    outputFolder,
    totalBytes: fsInfo.totalBytes,
    usedBytes: Math.max(0, fsInfo.totalBytes - fsInfo.availableBytes),
    availableBytes: fsInfo.availableBytes,
    clipsBytes,
  }
}

export function resolveRevealableCapturePath(filename: string): string | null {
  if (!/\.(mp4|mkv|mov|webm|png|jpe?g|webp)$/i.test(filename)) return null

  const capturePath = resolve(filename)
  for (const root of [currentOutputFolder(), defaultScreenshotFolder()]) {
    const relativePath = relative(resolve(root), capturePath)
    if (
      relativePath.length > 0 &&
      !relativePath.startsWith("..") &&
      !isAbsolute(relativePath)
    ) {
      return capturePath
    }
  }
  return null
}

export function currentOutputFolder(): string {
  return getRecordingSettings().outputFolder || defaultOutputFolder()
}

function ensureFolder(path: string) {
  try {
    mkdirSync(path, { recursive: true })
  } catch (cause) {
    logger.warn("failed to create capture folder:", cause)
  }
}

function readFilesystemInfo(path: string): {
  totalBytes: number
  availableBytes: number
} {
  try {
    const info = statfsSync(path)
    return {
      totalBytes: Number(info.blocks) * Number(info.bsize),
      availableBytes: Number(info.bavail) * Number(info.bsize),
    }
  } catch {
    return {
      totalBytes: 2_000 * GB,
      availableBytes: 0,
    }
  }
}

function sumCaptureBytes(path: string): number {
  try {
    return readdirSync(path).reduce((total, entry) => {
      const entryPath = join(path, entry)
      const stat = statSync(entryPath)
      if (stat.isDirectory()) return total + sumCaptureBytes(entryPath)
      return stat.isFile() && /\.(mp4|mkv|mov|webm)$/i.test(entry)
        ? total + stat.size
        : total
    }, 0)
  } catch {
    return 0
  }
}
