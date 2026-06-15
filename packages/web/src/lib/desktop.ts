import type {
  DesktopUpdateState,
  RecordingActionResult,
  RecordingActionRequest,
  RecordingDisplay,
  RecordingEvent,
  RecordingGameProcess,
  RecordingLibraryDownload,
  RecordingLibraryDownloadRequest,
  RecordingLibraryExport,
  RecordingLibraryExportRequest,
  RecordingLibraryFilesImportResult,
  RecordingLibraryImportRequest,
  RecordingLibraryImportResult,
  RecordingLibraryMetaPatch,
  RecordingLibraryMetaUpdateResult,
  RecordingLibraryProjectDraftSaveRequest,
  RecordingLibraryProjectDraftSaveResult,
  RecordingLibrarySnapshot,
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundLibrary,
  SaveReplayClipRequest,
  RecordingSettings,
  RecordingStatus,
  RecordingStorageInfo,
} from "@alloy/contracts"

// Recording-library contract types live in @alloy/contracts (single source of
// truth shared with the desktop main process); re-exported here so existing
// consumer imports keep working.
export type {
  RecordingCaptureMention,
  RecordingLibraryItem,
  RecordingLibraryDownload,
  RecordingLibraryDownloadRequest,
  RecordingLibraryDownloadStatus,
  RecordingLibraryExportSegment,
  RecordingLibraryExportRequest,
  RecordingLibraryMetaPatch,
  RecordingLibraryMetaUpdateResult,
  RecordingLibraryProjectTrack,
  RecordingLibraryProjectClip,
  RecordingLibraryProjectTransition,
  RecordingLibraryProject,
  RecordingLibraryProjectDraft,
  RecordingLibraryProjectDraftSaveRequest,
  RecordingLibraryProjectDraftSaveResult,
  RecordingLibraryExport,
  RecordingLibraryFilesImportResult,
  RecordingLibraryImportRequest,
  RecordingLibraryImportResult,
  RecordingLibraryGroup,
  RecordingLibrarySnapshot,
} from "@alloy/contracts"

export type DesktopConnectResult =
  | { ok: true; serverUrl: string }
  | { ok: false; error: string }

export interface DesktopSavedServer {
  serverUrl: string
  lastConnectedAt: string
}

export interface AlloyDesktopServerApi {
  connect(url: string): Promise<DesktopConnectResult>
  getServers(): Promise<DesktopSavedServer[]>
  getCurrentServer(): Promise<string | null>
  forgetServer(url: string): Promise<DesktopSavedServer[]>
}

export interface AlloyDesktopRecordingApi {
  getSettings(): Promise<RecordingSettings>
  setSettings(settings: RecordingSettings): Promise<RecordingSettings>
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
  /** Persists an unfinished multitrack editor project as a library draft. */
  saveLibraryProjectDraft(
    request: RecordingLibraryProjectDraftSaveRequest,
  ): Promise<RecordingLibraryProjectDraftSaveResult>
  /** Removes a saved project draft from the library manifest. */
  deleteLibraryProjectDraft(id: string): Promise<void>
  /** Moves a capture's file to the OS trash and forgets its metadata. */
  deleteLibraryCapture(id: string): Promise<void>
  /** Writes a rendered video into the capture library (editor exports). */
  importLibraryCapture(
    request: RecordingLibraryImportRequest,
  ): Promise<RecordingLibraryImportResult>
  /** Opens a native picker and copies the chosen video files into the library. */
  importLibraryFiles?(): Promise<RecordingLibraryFilesImportResult>
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
  selectOutputFolder(): Promise<string | null>
  listNotificationSounds(): Promise<RecordingNotificationSoundLibrary>
  openNotificationSoundsFolder(
    sound: RecordingNotificationSoundEvent,
  ): Promise<void>
  previewNotificationSound(
    sound: RecordingNotificationSoundEvent,
  ): Promise<void>
  listGameProcesses(): Promise<RecordingGameProcess[]>
  listDisplays(): Promise<RecordingDisplay[]>
  /**
   * Keeps live "audio-levels" events flowing for a few seconds; re-send as a
   * heartbeat while a level meter UI is visible.
   */
  subscribeAudioLevels(): Promise<void>
  /** Stops audio-level events without waiting for the subscription to expire. */
  stopAudioLevels(): Promise<void>
  saveReplayClip(request: SaveReplayClipRequest): Promise<RecordingActionResult>
  addBookmark(request: RecordingActionRequest): Promise<RecordingActionResult>
  takeScreenshot(
    request: RecordingActionRequest,
  ): Promise<RecordingActionResult>
  toggleLongRecording(
    request: RecordingActionRequest,
  ): Promise<RecordingActionResult>
  stopRecording(): Promise<RecordingActionResult>
  revealCapture(filename: string): Promise<void>
}

/** Desktop auto-update state and controls (absent on older desktop shells). */
export interface AlloyDesktopUpdatesApi {
  getState(): Promise<DesktopUpdateState>
  /** Quits and installs the downloaded update; no-op when none is ready. */
  restartToInstall(): Promise<void>
  onState(listener: (state: DesktopUpdateState) => void): () => void
}

export interface AlloyDesktop {
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
  updates?: AlloyDesktopUpdatesApi
}

export function alloyDesktop(): AlloyDesktop | null {
  return (globalThis as { alloyDesktop?: AlloyDesktop }).alloyDesktop ?? null
}

/**
 * In-renderer signal that capture metadata changed outside the library page
 * (e.g. an upload finalized and linked a capture to its server clip), so
 * snapshot consumers re-scan without waiting for a recorder event.
 */
const LIBRARY_CAPTURES_CHANGED_EVENT = "alloy:library-captures-changed"

export function notifyLibraryCapturesChanged(): void {
  window.dispatchEvent(new Event(LIBRARY_CAPTURES_CHANGED_EVENT))
}

export function onLibraryCapturesChanged(listener: () => void): () => void {
  window.addEventListener(LIBRARY_CAPTURES_CHANGED_EVENT, listener)
  return () =>
    window.removeEventListener(LIBRARY_CAPTURES_CHANGED_EVENT, listener)
}

/**
 * Routes a remote image URL through the desktop shell's persistent asset
 * cache (`alloy-asset://`) when running inside Alloy Desktop, so game icons
 * and similar assets load from disk and survive offline servers. Outside the
 * desktop app — or for non-http(s)/already-proxied URLs — the URL is returned
 * unchanged.
 */
export function desktopCachedAssetUrl(url: string | null): string | null {
  if (!url || !alloyDesktop()) return url
  if (!/^https?:\/\//i.test(url)) return url
  const bytes = new TextEncoder().encode(url)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return `alloy-asset://remote/${encoded}`
}
