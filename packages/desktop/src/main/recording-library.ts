/**
 * Public surface of the recording capture library. Implementation lives in
 * cohesive sibling modules:
 *
 * - `recording-library-protocol` — the `alloy-capture://` media protocol.
 * - `recording-library-scan` — disk scanning, grouping, and snapshots.
 * - `recording-library-store` — manifest mutations (remember/update/import/
 *   delete) and reveal actions.
 * - `recording-library-export` — trimmed exports for publishing.
 */
import type {
  RecordingLibraryCommitStagedImportRequest,
  RecordingLibraryExportRequest,
} from "@alloy/contracts"

export {
  recordingLibraryProtocolScheme,
  registerRecordingLibraryProtocol,
} from "./recording-library-protocol"
export { getRecordingLibrarySnapshot } from "./recording-library-scan"
export {
  deleteRecordingLibraryItem,
  rememberRecordingLibraryCapture,
  revealRecordingLibraryItem,
  setRecordingLibraryCaptureTrim,
  updateRecordingLibraryCaptureMeta,
} from "./recording-library-store"

export async function exportRecordingLibraryItem(
  request: RecordingLibraryExportRequest,
) {
  const { exportRecordingLibraryItem } =
    await import("./recording-library-export")
  return exportRecordingLibraryItem(request)
}

export async function stageRecordingLibraryVideoFiles(paths: string[]) {
  const { stageRecordingLibraryVideoFiles } =
    await import("./recording-library-import")
  return stageRecordingLibraryVideoFiles(paths)
}

export async function commitRecordingLibraryStagedImport(
  request: RecordingLibraryCommitStagedImportRequest,
) {
  const { commitRecordingLibraryStagedImport } =
    await import("./recording-library-import")
  return commitRecordingLibraryStagedImport(request)
}

export async function discardRecordingLibraryStagedImport(id: string) {
  const { discardRecordingLibraryStagedImport } =
    await import("./recording-library-import")
  return discardRecordingLibraryStagedImport(id)
}
