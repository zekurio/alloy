import { Worker } from "node:worker_threads"

import type {
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"

import { cachedAssetUrl } from "./asset-cache"
import { readCaptureManifest } from "./recording-library-manifest"
import {
  createRecordingLibrarySnapshot,
  findRecordingLibraryItemInScan,
  type RecordingLibraryScanInput,
  type RecordingLibraryScanWorkerRequest,
  type RecordingLibraryScanWorkerResponse,
} from "./recording-library-scan-core"
import { currentOutputFolder } from "./recording-storage"
import { getThumbnailBlurHashes } from "./recording-thumbnail-meta"

const logger = createLogger("library")

const SCAN_WORKER_IDLE_TIMEOUT_MS = 30_000

interface PendingScan {
  resolve: (snapshot: RecordingLibrarySnapshot) => void
  reject: (error: Error) => void
}

let scanWorker: Worker | null = null
let scanWorkerIdleTimer: ReturnType<typeof setTimeout> | null = null
let nextScanId = 1
let pendingSnapshot: Promise<RecordingLibrarySnapshot> | null = null
const pendingScans = new Map<number, PendingScan>()

export function getRecordingLibrarySnapshot(): Promise<RecordingLibrarySnapshot> {
  const input = recordingLibraryScanInput()
  if (pendingSnapshot) return pendingSnapshot

  const task = scanRecordingLibrarySnapshotInWorker(input)
    .catch((cause: unknown) => {
      logger.warn("recording library worker scan failed; falling back:", cause)
      return createRecordingLibrarySnapshot(input)
    })
    .then(withCachedAssetUrls)
    .finally(() => {
      if (pendingSnapshot === task) pendingSnapshot = null
    })

  pendingSnapshot = task
  return task
}

export function invalidateRecordingLibrarySnapshot(): void {
  pendingSnapshot = null
}

export function findRecordingLibraryItem(
  id: string,
): RecordingLibraryItem | null {
  const item = findRecordingLibraryItemInScan(recordingLibraryScanInput(), id)
  return item ? withCachedAssetUrl(item) : null
}

function scanRecordingLibrarySnapshotInWorker(
  input: RecordingLibraryScanInput,
): Promise<RecordingLibrarySnapshot> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = recordingLibraryScanWorker()
    } catch (cause) {
      reject(
        cause instanceof Error
          ? cause
          : new Error("Recording library worker failed to start."),
      )
      return
    }

    const id = nextScanId++
    const request: RecordingLibraryScanWorkerRequest = { id, input }
    pendingScans.set(id, { resolve, reject })
    try {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node worker_threads postMessage does not take a targetOrigin.
      worker.postMessage(request)
    } catch (cause) {
      pendingScans.delete(id)
      reject(
        cause instanceof Error
          ? cause
          : new Error("Recording library worker rejected scan input."),
      )
    }
  })
}

function recordingLibraryScanWorker(): Worker {
  if (scanWorker) {
    clearScanWorkerIdleTimer()
    return scanWorker
  }

  const worker = new Worker(
    new URL("./recording-library-scan-worker.js", import.meta.url),
  )
  worker.on("message", handleScanWorkerMessage)
  worker.on("error", (cause) => {
    rejectPendingScans(
      cause instanceof Error
        ? cause
        : new Error("Recording library worker failed."),
    )
  })
  worker.on("exit", (code) => {
    if (scanWorker === worker) scanWorker = null
    clearScanWorkerIdleTimer()
    if (pendingScans.size > 0) {
      rejectPendingScans(
        new Error(`Recording library worker exited with code ${code}.`),
      )
    }
  })

  scanWorker = worker
  return worker
}

function handleScanWorkerMessage(message: unknown): void {
  if (!isScanWorkerResponse(message)) return

  const pending = pendingScans.get(message.id)
  if (!pending) return
  pendingScans.delete(message.id)

  if (message.ok) {
    pending.resolve(message.snapshot)
    scheduleScanWorkerIdleShutdown()
    return
  }

  pending.reject(new Error(message.error))
  scheduleScanWorkerIdleShutdown()
}

function scheduleScanWorkerIdleShutdown(): void {
  if (!scanWorker || pendingScans.size > 0 || scanWorkerIdleTimer) return
  scanWorkerIdleTimer = setTimeout(() => {
    scanWorkerIdleTimer = null
    const worker = scanWorker
    scanWorker = null
    void worker?.terminate()
  }, SCAN_WORKER_IDLE_TIMEOUT_MS)
  scanWorkerIdleTimer.unref?.()
}

function clearScanWorkerIdleTimer(): void {
  if (!scanWorkerIdleTimer) return
  clearTimeout(scanWorkerIdleTimer)
  scanWorkerIdleTimer = null
}

function rejectPendingScans(error: Error): void {
  for (const pending of pendingScans.values()) {
    pending.reject(error)
  }
  pendingScans.clear()
}

function isScanWorkerResponse(
  value: unknown,
): value is RecordingLibraryScanWorkerResponse {
  if (typeof value !== "object" || value === null) return false
  const response = value as Record<string, unknown>
  return (
    typeof response.id === "number" &&
    typeof response.ok === "boolean" &&
    (response.ok
      ? typeof response.snapshot === "object" && response.snapshot !== null
      : typeof response.error === "string")
  )
}

function recordingLibraryScanInput(): RecordingLibraryScanInput {
  return {
    outputFolder: currentOutputFolder(),
    manifest: readCaptureManifest(),
    hiddenFileKeys: [],
    thumbnailBlurHashes: getThumbnailBlurHashes(),
  }
}

function withCachedAssetUrls(
  snapshot: RecordingLibrarySnapshot,
): RecordingLibrarySnapshot {
  const itemById = new Map<string, RecordingLibraryItem>()
  const items = snapshot.items.map((item) => {
    const mapped = withCachedAssetUrl(item)
    itemById.set(mapped.id, mapped)
    return mapped
  })
  const groups = snapshot.groups.map((group) => ({
    ...group,
    iconUrl: cachedAssetUrl(group.iconUrl),
    items: group.items.map(
      (item) => itemById.get(item.id) ?? withCachedAssetUrl(item),
    ),
  }))

  return { ...snapshot, items, groups }
}

function withCachedAssetUrl(item: RecordingLibraryItem): RecordingLibraryItem {
  return {
    ...item,
    gameIconUrl: cachedAssetUrl(item.gameIconUrl),
  }
}
