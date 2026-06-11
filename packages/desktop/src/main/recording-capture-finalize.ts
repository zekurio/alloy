import { copyFileSync, renameSync, rmSync, statSync } from "node:fs"

import type { RecordingCapture } from "@alloy/contracts"
import { logger } from "@alloy/logging"

import { concatMp4Segments, trimMp4Tail } from "./media"

const pendingFinalizes = new Map<string, Promise<RecordingCapture>>()

export function finalizeRecordingCapture(
  capture: RecordingCapture,
): Promise<RecordingCapture> {
  if (!capture.postProcess) return Promise.resolve(clearedCapture(capture))

  const pending = pendingFinalizes.get(capture.filename)
  if (pending) return pending

  const task = runFinalize(capture).finally(() => {
    pendingFinalizes.delete(capture.filename)
  })
  pendingFinalizes.set(capture.filename, task)
  return task
}

async function runFinalize(
  capture: RecordingCapture,
): Promise<RecordingCapture> {
  switch (capture.postProcess?.kind) {
    case "trim-tail":
      await finalizeTrimTail(capture.filename, capture.postProcess.keepMs)
      break
    case "concat-segments":
      await finalizeConcatSegments(
        capture.filename,
        capture.postProcess.segmentPaths,
      )
      break
  }

  return {
    ...capture,
    postProcess: null,
    sizeBytes: statCaptureSize(capture.filename, capture.sizeBytes),
  }
}

async function finalizeTrimTail(
  filename: string,
  keepMs: number,
): Promise<void> {
  const tmp = `${filename}.trim.tmp`
  try {
    const trimmed = await trimMp4Tail(filename, tmp, keepMs)
    if (trimmed) renameSync(tmp, filename)
    else removeFile(tmp)
  } catch (cause) {
    removeFile(tmp)
    logger.warn("[desktop] failed to trim replay tail:", cause)
  }
}

async function finalizeConcatSegments(
  filename: string,
  segmentPaths: string[],
): Promise<void> {
  if (segmentPaths.length === 0) return

  const tmp = `${filename}.concat.tmp`
  try {
    await concatMp4Segments(segmentPaths, tmp)
    renameSync(tmp, filename)
  } catch (cause) {
    removeFile(tmp)
    logger.warn("[desktop] failed to concatenate disk replay segments:", cause)
    restoreLastSegment(filename, segmentPaths)
  } finally {
    for (const path of segmentPaths) removeFile(path)
  }
}

function restoreLastSegment(filename: string, segmentPaths: string[]): void {
  const last = segmentPaths.at(-1)
  if (!last) return
  try {
    renameSync(last, filename)
  } catch {
    try {
      copyFileSync(last, filename)
    } catch (cause) {
      logger.warn("[desktop] failed to keep final replay segment:", cause)
    }
  }
}

function statCaptureSize(
  filename: string,
  fallback: number | null,
): number | null {
  try {
    return statSync(filename).size
  } catch {
    return fallback
  }
}

function removeFile(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    // Best effort cleanup; stale .tmp files are ignored by the library scan.
  }
}

function clearedCapture(capture: RecordingCapture): RecordingCapture {
  return capture.postProcess ? { ...capture, postProcess: null } : capture
}
