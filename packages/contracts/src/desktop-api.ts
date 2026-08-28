import type { AlloyDesktopAutostartApi } from "./desktop-autostart"
import type { AlloyDesktopNotificationsApi } from "./desktop-notification"
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
import type { AlloyDesktopUpdatesApi } from "./desktop-update"

export const DESKTOP_APP_SCHEME = "alloy-app" as const
export const DESKTOP_APP_HOST = "app" as const
export const DESKTOP_APP_ORIGIN =
  `${DESKTOP_APP_SCHEME}://${DESKTOP_APP_HOST}` as const
export const DESKTOP_APP_DOCUMENT = "desktop.html" as const
export const DESKTOP_APP_URL =
  `${DESKTOP_APP_ORIGIN}/${DESKTOP_APP_DOCUMENT}` as const

/**
 * Single source of truth for the lockstep `window.alloyDesktop` API shared by
 * the bundled renderer, preload, and main process.
 */
export type DesktopConnectResult =
  | { ok: true; serverUrl: string }
  | { ok: false; error: string }

export interface DesktopConnectOptions {
  forceBrowserLogin?: boolean
}

export interface DesktopSavedServer {
  serverUrl: string
  lastConnectedAt: string
  /** Last exact desktop HTTP contract validated for this server. */
  httpContract: number
}

export interface AlloyDesktopServerApi {
  connect(
    url: string,
    options?: DesktopConnectOptions,
  ): Promise<DesktopConnectResult>
  getServers(): Promise<DesktopSavedServer[]>
  getCurrentServer(): Promise<string | null>
  forgetServer(url: string): Promise<DesktopSavedServer[]>
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
   * Fetchable `alloy-capture://` URL for one audio track of a local
   * multi-track capture, extracting the capture's stems to a local cache on
   * first use. `index` is the capture's zero-based container audio track
   * index (0 is the embedded mix; stems occupy 1..N). Null when the capture
   * or track does not exist or its stems cannot be extracted.
   */
  getLibraryCaptureAudioTrackUrl(
    id: string,
    index: number,
  ): Promise<string | null>
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

/**
 * The desktop API exposed to the bundled renderer as `window.alloyDesktop`.
 * Native side effects stay behind explicit IPC handlers; no raw Electron APIs
 * reach the renderer.
 */
export interface AlloyDesktop {
  /** True when the web app header must provide the draggable title bar. */
  titlebarOverlay: boolean
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  openConnect(): Promise<void>
  openSettings(): Promise<void>
  reloadApp(): Promise<void>
  servers: AlloyDesktopServerApi
  recording: AlloyDesktopRecordingApi
  updates: AlloyDesktopUpdatesApi
  autostart: AlloyDesktopAutostartApi
  notifications: AlloyDesktopNotificationsApi
}
