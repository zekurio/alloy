import type {
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundLibrary,
  RecordingSettings,
} from "./desktop-recording-config"
import type { RecordingGameProcess } from "./desktop-recording-games"
import type {
  RecordingLibraryCommitStagedImportRequest,
  RecordingLibraryDownload,
  RecordingLibraryDownloadRequest,
  RecordingLibraryExport,
  RecordingLibraryExportRequest,
  RecordingLibraryImportResult,
  RecordingLibraryMetaPatch,
  RecordingLibraryMetaUpdateResult,
  RecordingLibrarySnapshot,
  RecordingLibraryStagedImport,
  RecordingLibraryTrimUpdate,
} from "./desktop-recording-library"
import type {
  RecordingDisplay,
  RecordingEvent,
  RecordingStatus,
  RecordingStorageInfo,
} from "./desktop-recording-status"
import type { DesktopShortcutsState } from "./desktop-shortcuts"

export interface DesktopSavedServer {
  serverUrl: string
  lastConnectedAt: string
  /** Server version returned by the most recent successful native validation. */
  serverVersion: string
  /** Last exact desktop HTTP contract validated for this server. */
  httpContract: number
  /** Last exact native bridge contract advertised by this server's web app. */
  bridgeContract: number
}

export interface AlloyDesktopRecordingApi {
  getSettings(): Promise<RecordingSettings>
  setSettings(settings: RecordingSettings): Promise<RecordingSettings>
  restartBackend(): Promise<RecordingStatus>
  getStatus(): Promise<RecordingStatus>
  getStorageInfo(): Promise<RecordingStorageInfo>
  getLibrary(): Promise<RecordingLibrarySnapshot>
  revealLibraryCapture(id: string): Promise<void>
  exportLibraryCapture(
    request: RecordingLibraryExportRequest,
  ): Promise<RecordingLibraryExport>
  /**
   * Gives back an export once its bytes have been read. The host deletes a
   * render nobody holds any more; a whole-capture export has nothing to
   * delete.
   */
  releaseLibraryExport(id: string): Promise<void>
  /** Persists draft upload metadata for a capture across app restarts. */
  updateLibraryCapture(
    patch: RecordingLibraryMetaPatch,
  ): Promise<RecordingLibraryMetaUpdateResult>
  /**
   * Persists a non-destructive trim range for a capture, or clears it when
   * both bounds are null. Playback and publish read the trim as metadata;
   * the capture's source file is never rewritten.
   */
  setLibraryCaptureTrim(
    request: RecordingLibraryTrimUpdate,
  ): Promise<RecordingLibraryMetaUpdateResult>
  /** Moves a capture's file to the OS trash and forgets its metadata. */
  deleteLibraryCapture(id: string): Promise<void>
  /**
   * Opens a native picker and stages the chosen media file by reference.
   * Resolves null if the picker was dismissed and rejects with a user-facing
   * message if the file cannot be imported.
   */
  importLibraryFile(): Promise<RecordingLibraryStagedImport | null>
  /** Copies a staged picked file into the capture library. */
  commitStagedLibraryImport(
    request: RecordingLibraryCommitStagedImportRequest,
  ): Promise<RecordingLibraryImportResult>
  /** Forgets a staged picked file. */
  discardStagedLibraryImport(id: string): Promise<void>
  /**
   * Persists an uploaded clip into the local capture library. Progress
   * streams out as "library-download" recording events.
   */
  downloadClip(
    request: RecordingLibraryDownloadRequest,
  ): Promise<RecordingLibraryDownload>
  /** Aborts an in-flight clip download, or forgets a finished one. */
  cancelClipDownload(clipId: string): Promise<void>
  /** Snapshot of active + finished (undismissed) clip downloads. */
  listClipDownloads(): Promise<RecordingLibraryDownload[]>
  onEvent(listener: (event: RecordingEvent) => void): () => void
  /**
   * Opens a native folder picker and makes the chosen folder the capture
   * folder; returns it, or null if cancelled.
   */
  selectOutputFolder(): Promise<string | null>
  /** Returns running processes that can be added to the game allow list. */
  listGameProcesses(): Promise<RecordingGameProcess[]>
  /** Returns displays that can be selected for desktop capture. */
  listDisplays(): Promise<RecordingDisplay[]>
  /**
   * Keeps live "audio-levels" events flowing for a few seconds; re-send as a
   * heartbeat while a level meter UI is visible.
   */
  subscribeAudioLevels(): Promise<void>
  /** Stops audio-level events without waiting for the subscription to expire. */
  stopAudioLevels(): Promise<void>
  /** Lists the audio files available in the shared notification sounds folder. */
  listNotificationSounds(): Promise<RecordingNotificationSoundLibrary>
  /** Opens the shared notification sounds folder so the user can add files. */
  openNotificationSoundsFolder(
    sound: RecordingNotificationSoundEvent,
  ): Promise<void>
  /** Plays an event's configured sound once so the user can audition it. */
  previewNotificationSound(
    sound: RecordingNotificationSoundEvent,
  ): Promise<void>
  /**
   * The clip and screenshot shortcuts the desktop binds. Changes stream out
   * as "shortcuts" recording events.
   */
  getShortcuts(): Promise<DesktopShortcutsState>
  /** Binds the shortcuts again in a new session, after an error. */
  bindShortcuts(): Promise<DesktopShortcutsState>
  /**
   * Opens the desktop's settings for the shortcuts. Only when the state is
   * `configurable`.
   */
  configureShortcuts(): Promise<void>
}
