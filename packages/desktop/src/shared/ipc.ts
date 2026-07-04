import type {
  AlloyDesktopUpdatesApi,
  PublicAuthConfig,
  RecordingActionResult,
  RecordingDisplay,
  RecordingEvent,
  RecordingGameProcess,
  RecordingLibraryDownload,
  RecordingLibraryDownloadRequest,
  RecordingLibraryExport,
  RecordingLibraryExportRequest,
  RecordingLibraryCommitStagedImportRequest,
  RecordingLibraryFilesImportResult,
  RecordingLibraryImportResult,
  RecordingLibraryMetaPatch,
  RecordingLibraryMetaUpdateResult,
  RecordingLibrarySnapshot,
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundLibrary,
  SaveReplayClipRequest,
  RecordingSettings,
  RecordingStatus,
  RecordingStorageInfo,
} from "@alloy/contracts"

// Recording-library contract types live in @alloy/contracts (single source of
// truth shared with the web app); re-exported here so existing consumer
// imports keep working.
export type {
  RecordingCaptureMention,
  RecordingLibraryItem,
  RecordingLibraryDownload,
  RecordingLibraryDownloadRequest,
  RecordingLibraryDownloadStatus,
  RecordingLibraryExportSegment,
  RecordingLibraryExportRequest,
  RecordingLibraryCommitStagedImportRequest,
  RecordingLibraryMetaPatch,
  RecordingLibraryMetaUpdateResult,
  RecordingLibraryExport,
  RecordingLibraryFilesImportResult,
  RecordingLibraryImportResult,
  RecordingLibraryStagedImport,
  RecordingLibraryGroup,
  RecordingLibrarySnapshot,
} from "@alloy/contracts"

/**
 * IPC channel names shared between the main process, the overlay preload, and
 * the overlay renderer. Kept in one place so the privileged surface exposed to
 * the overlay is auditable and the renderer/preload can't drift from main.
 */
export const IPC = {
  probe: "alloy:probe",
  connect: "alloy:connect",
  openConnect: "alloy:open-connect",
  openLibrary: "alloy:open-library",
  getStartupServer: "alloy:get-startup-server",
  getServers: "alloy:get-servers",
  getCurrentServer: "alloy:get-current-server",
  forgetServer: "alloy:forget-server",
  openSettings: "alloy:open-settings",
  getRecordingSettings: "alloy:get-recording-settings",
  setRecordingSettings: "alloy:set-recording-settings",
  restartRecordingBackend: "alloy:restart-recording-backend",
  getRecordingStatus: "alloy:get-recording-status",
  getRecordingStorageInfo: "alloy:get-recording-storage-info",
  getRecordingLibrary: "alloy:get-recording-library",
  openRecordingLibraryFolder: "alloy:open-recording-library-folder",
  openRecordingLibraryCapture: "alloy:open-recording-library-capture",
  revealRecordingLibraryCapture: "alloy:reveal-recording-library-capture",
  exportRecordingLibraryCapture: "alloy:export-recording-library-capture",
  updateRecordingLibraryCapture: "alloy:update-recording-library-capture",
  deleteRecordingLibraryCapture: "alloy:delete-recording-library-capture",
  importRecordingLibraryFiles: "alloy:import-recording-library-files",
  commitRecordingLibraryStagedImport:
    "alloy:commit-recording-library-staged-import",
  discardRecordingLibraryStagedImport:
    "alloy:discard-recording-library-staged-import",
  saveRecordingLibraryCaptureThumbnail:
    "alloy:save-recording-library-capture-thumbnail",
  downloadRecordingLibraryClip: "alloy:download-recording-library-clip",
  cancelRecordingLibraryClipDownload:
    "alloy:cancel-recording-library-clip-download",
  listRecordingLibraryClipDownloads:
    "alloy:list-recording-library-clip-downloads",
  recordingEvent: "alloy:recording-event",
  selectOutputFolder: "alloy:select-output-folder",
  listNotificationSounds: "alloy:list-notification-sounds",
  openNotificationSoundsFolder: "alloy:open-notification-sounds-folder",
  previewNotificationSound: "alloy:preview-notification-sound",
  listGameProcesses: "alloy:list-game-processes",
  listRecordingDisplays: "alloy:list-recording-displays",
  subscribeRecordingAudioLevels: "alloy:subscribe-recording-audio-levels",
  stopAudioLevels: "alloy:stop-audio-levels",
  saveReplayClip: "alloy:save-replay-clip",
  revealRecordingCapture: "alloy:reveal-recording-capture",
  minimizeWindow: "alloy:minimize-window",
  toggleMaximizeWindow: "alloy:toggle-maximize-window",
  closeWindow: "alloy:close-window",
  getUpdateState: "alloy:get-update-state",
  getUpdateChannel: "alloy:get-update-channel",
  setUpdateChannel: "alloy:set-update-channel",
  checkForUpdates: "alloy:check-for-updates",
  restartToInstallUpdate: "alloy:restart-to-install-update",
  updateEvent: "alloy:update-event",
} as const

/** Result of probing a candidate server URL for a valid Alloy endpoint. */
export type ProbeResult =
  | { ok: true; serverUrl: string; config: PublicAuthConfig }
  | { ok: false; error: string }

/** Result of committing to a server: persists the URL and loads the app. */
export type ConnectResult =
  | { ok: true; serverUrl: string }
  | {
      ok: false
      error: string
    }

export interface ConnectOptions {
  forceBrowserLogin?: boolean
}

export interface SavedServer {
  serverUrl: string
  lastConnectedAt: string
}

/**
 * The privileged native surface bridged into the bundled overlay renderer via
 * `contextBridge`.
 */
export interface AlloyNative {
  probe(url: string): Promise<ProbeResult>
  connect(url: string, options?: ConnectOptions): Promise<ConnectResult>
  getStartupServer(): Promise<string | null>
  getServers(): Promise<SavedServer[]>
  forgetServer(url: string): Promise<SavedServer[]>
}

export interface AlloyDesktopServerApi {
  connect(url: string, options?: ConnectOptions): Promise<ConnectResult>
  getServers(): Promise<SavedServer[]>
  getCurrentServer(): Promise<string | null>
  forgetServer(url: string): Promise<SavedServer[]>
}

export interface AlloyDesktopRecordingApi {
  getSettings(): Promise<RecordingSettings>
  setSettings(settings: RecordingSettings): Promise<RecordingSettings>
  restartBackend(): Promise<RecordingStatus>
  getStatus(): Promise<RecordingStatus>
  getStorageInfo(): Promise<RecordingStorageInfo>
  getLibrary(): Promise<RecordingLibrarySnapshot>
  openLibraryFolder(): Promise<void>
  openLibraryCapture(id: string): Promise<void>
  revealLibraryCapture(id: string): Promise<void>
  exportLibraryCapture(
    request: RecordingLibraryExportRequest,
  ): Promise<RecordingLibraryExport>
  /** Persists draft upload metadata for a capture across app restarts. */
  updateLibraryCapture(
    patch: RecordingLibraryMetaPatch,
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
  saveReplayClip(request: SaveReplayClipRequest): Promise<RecordingActionResult>
  revealCapture(filename: string): Promise<void>
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

/**
 * Desktop bridge exposed to the configured Alloy web app. Native side effects
 * stay behind explicit IPC handlers; no raw Electron APIs reach the renderer.
 */
export interface AlloyDesktopMarker {
  platform: string
  titlebarOverlay: boolean
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  openConnect(): Promise<void>
  openLibrary(): Promise<void>
  openSettings(): Promise<void>
  servers: AlloyDesktopServerApi
  recording: AlloyDesktopRecordingApi
  updates: AlloyDesktopUpdatesApi
}
