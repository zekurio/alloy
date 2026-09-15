import type {
  RecordingLibraryCommitStagedImportRequest,
  RecordingLibraryDownload,
  RecordingLibraryDownloadRequest,
  RecordingLibraryExport,
  RecordingLibraryExportRequest,
  RecordingLibraryFilesImportResult,
  RecordingLibraryImportResult,
  RecordingLibraryMetaPatch,
  RecordingLibraryMetaUpdateResult,
  RecordingLibrarySnapshot,
  RecordingLibraryTrimUpdate,
} from "./desktop-recording-library"
import type {
  RecordingDisplay,
  RecordingEvent,
  RecordingGameProcess,
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundLibrary,
  RecordingSettings,
  RecordingStatus,
  RecordingStorageInfo,
} from "./desktop-recording-types"

export interface DesktopSavedServer {
  serverUrl: string
  lastConnectedAt: string
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
  /** Opens a native picker and copies the chosen video files into a temporary import stage. */
  importLibraryFiles(): Promise<RecordingLibraryFilesImportResult>
  /** Commits a staged picked file into the capture library. */
  commitStagedLibraryImport(
    request: RecordingLibraryCommitStagedImportRequest,
  ): Promise<RecordingLibraryImportResult>
  /** Deletes a picked file from the temporary import stage. */
  discardStagedLibraryImport(id: string): Promise<void>
  /** Persists a renderer-decoded JPEG poster for a local video capture. */
  saveLibraryCaptureThumbnail(id: string, data: Uint8Array): Promise<void>
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
  /** Opens a native folder picker; returns the chosen path or null if cancelled. */
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
}
