/**
 * Public surface of the recording capture library. Implementation lives in
 * cohesive sibling modules:
 *
 * - `recording-library-protocol` — the `alloy-capture://` media protocol.
 * - `recording-library-scan` — disk scanning, grouping, and snapshots.
 * - `recording-library-store` — manifest mutations (remember/update/import/
 *   delete) and open/reveal actions.
 * - `recording-library-export` — trimmed exports for publishing.
 */
export { exportRecordingLibraryItem } from "./recording-library-export"
export {
  recordingLibraryProtocolScheme,
  registerRecordingLibraryProtocol,
} from "./recording-library-protocol"
export { getRecordingLibrarySnapshot } from "./recording-library-scan"
export { cleanupLegacyFilmstripCache } from "./recording-library-thumbnails"
export {
  deleteRecordingLibraryItem,
  openRecordingLibraryFolder,
  openRecordingLibraryItem,
  rememberRecordingLibraryCapture,
  revealRecordingLibraryItem,
  updateRecordingLibraryCaptureMeta,
} from "./recording-library-store"
export {
  commitRecordingLibraryStagedImport,
  discardRecordingLibraryStagedImport,
  importRecordingLibraryCapture,
  stageRecordingLibraryVideoFiles,
} from "./recording-library-import"
export {
  deleteRecordingLibraryProjectDraft,
  saveRecordingLibraryProjectDraft,
} from "./recording-library-project-drafts"
