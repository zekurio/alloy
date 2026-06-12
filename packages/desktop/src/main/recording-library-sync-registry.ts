import type {
  RecordingLibrarySyncItemStatus,
  RecordingLibrarySyncState,
} from "@alloy/contracts"

/**
 * Tiny shared lookup of per-capture sync statuses. The sync engine writes it
 * on every queue change; the library scan reads it to badge items — kept
 * separate so the scan doesn't import the engine (which imports the scan).
 */

const statusByCaptureId = new Map<string, RecordingLibrarySyncItemStatus>()

export function setSyncRegistryStatuses(
  entries: Iterable<[string, RecordingLibrarySyncItemStatus]>,
): void {
  statusByCaptureId.clear()
  for (const [captureId, status] of entries) {
    statusByCaptureId.set(captureId, status)
  }
}

/** Card-level sync state for a capture; "synced" is derived from the manifest. */
export function syncStateForCapture(
  captureId: string,
  uploadedClipId: string | null,
): RecordingLibrarySyncState {
  if (uploadedClipId) return "synced"
  const status = statusByCaptureId.get(captureId)
  if (!status) return "none"
  if (status === "queued") return "queued"
  if (status === "failed") return "failed"
  if (status === "completed") return "synced"
  return "syncing"
}
