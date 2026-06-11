import type {
  RecordingActionResult,
  RecordingActionRequest,
  RecordingDisplay,
  RecordingEvent,
  RecordingGameProcess,
  RecordingLibraryExport,
  RecordingLibraryExportRequest,
  RecordingLibraryImportRequest,
  RecordingLibraryImportResult,
  RecordingLibraryMetaPatch,
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
  RecordingLibraryExportSegment,
  RecordingLibraryExportRequest,
  RecordingLibraryMetaPatch,
  RecordingLibraryProjectTrack,
  RecordingLibraryProjectClip,
  RecordingLibraryProjectTransition,
  RecordingLibraryProject,
  RecordingLibraryProjectDraft,
  RecordingLibraryProjectDraftSaveRequest,
  RecordingLibraryProjectDraftSaveResult,
  RecordingLibraryExport,
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
  /** Video keyframe (I-frame) positions in ms for the editor timeline. */
  libraryCaptureKeyframes(id: string): Promise<number[]>
  /** Persists draft upload metadata for a capture across app restarts. */
  updateLibraryCapture(patch: RecordingLibraryMetaPatch): Promise<void>
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
  onEvent(listener: (event: RecordingEvent) => void): () => void
  selectOutputFolder(): Promise<string | null>
  listNotificationSounds(): Promise<RecordingNotificationSoundLibrary>
  openNotificationSoundsFolder(
    sound: RecordingNotificationSoundEvent,
  ): Promise<void>
  listGameProcesses(): Promise<RecordingGameProcess[]>
  listDisplays(): Promise<RecordingDisplay[]>
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
}

export function alloyDesktop(): AlloyDesktop | null {
  return (globalThis as { alloyDesktop?: AlloyDesktop }).alloyDesktop ?? null
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
