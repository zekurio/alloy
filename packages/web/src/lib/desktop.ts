import type {
  ClipPrivacy,
  RecordingActionResult,
  RecordingActionRequest,
  RecordingCaptureKind,
  RecordingCaptureSource,
  RecordingDisplay,
  RecordingEvent,
  RecordingGameProcess,
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundLibrary,
  SaveReplayClipRequest,
  RecordingSettings,
  RecordingStatus,
  RecordingStorageInfo,
} from "alloy-contracts"

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

/** Minimal user summary persisted with capture drafts to rehydrate pickers. */
export interface RecordingCaptureMention {
  id: string
  username: string
  displayUsername: string
  image: string | null
}

export interface RecordingLibraryItem {
  id: string
  title: string
  filename: string
  fileName: string
  mediaUrl: string
  thumbnailUrl: string | null
  /** Evenly spaced editor-timeline filmstrip frames (empty for screenshots). */
  filmstripFrameUrls: string[]
  thumbBlurHash: string | null
  collection: "Clips" | "Sessions" | "Screenshots"
  kind: RecordingCaptureKind
  source: RecordingCaptureSource
  groupKey: string
  groupLabel: string
  gameName: string | null
  gameIconUrl: string | null
  sizeBytes: number
  durationMs: number | null
  width: number | null
  height: number | null
  description: string | null
  tags: string | null
  mentions: RecordingCaptureMention[]
  privacy: ClipPrivacy | null
  createdAt: string
  modifiedAt: string
}

/** One source range of an edited sequence, in playback order. */
export interface RecordingLibraryExportSegment {
  startMs: number
  endMs: number
}

export interface RecordingLibraryExportRequest {
  id: string
  /** Ordered segments to keep; multiple segments concatenate on export. */
  segments: RecordingLibraryExportSegment[]
}

export interface RecordingLibraryMetaPatch {
  id: string
  title?: string
  description?: string | null
  tags?: string | null
  mentions?: RecordingCaptureMention[]
  privacy?: ClipPrivacy | null
}

export interface RecordingLibraryProjectTrack {
  id: string
  label: string
}

export interface RecordingLibraryProjectClip {
  id: string
  trackId: string
  sourceId: string
  sourceDurationMs: number
  sourceStartMs: number
  sourceEndMs: number
  startMs: number
  label: string
}

export interface RecordingLibraryProjectTransition {
  id: string
  type: "crossfade"
  leftClipId: string
  rightClipId: string
  durationMs: number
}

export interface RecordingLibraryProject {
  tracks: RecordingLibraryProjectTrack[]
  clips: RecordingLibraryProjectClip[]
  transitions: RecordingLibraryProjectTransition[]
}

export interface RecordingLibraryProjectDraft {
  id: string
  title: string
  project: RecordingLibraryProject
  thumbnailSourceId: string | null
  durationMs: number
  clipCount: number
  createdAt: string
  updatedAt: string
}

export interface RecordingLibraryProjectDraftSaveRequest {
  id?: string | null
  title: string
  project: RecordingLibraryProject
}

export interface RecordingLibraryProjectDraftSaveResult {
  id: string
}

export interface RecordingLibraryExport {
  id: string
  mediaUrl: string
  fileName: string
  contentType: string
  sizeBytes: number
  durationMs: number
  width: number | null
  height: number | null
  thumbBlurHash: string | null
}

/** A rendered video to add to the capture library (from the editor). */
export interface RecordingLibraryImportRequest {
  /** Suggested file name (sanitized and uniquified on write); ".mp4" added. */
  fileName: string
  data: Uint8Array
  durationMs: number
  width: number | null
  height: number | null
}

export interface RecordingLibraryImportResult {
  /** Library capture id of the imported file. */
  id: string
}

export interface RecordingLibraryGroup {
  key: string
  label: string
  kind: "game" | "desktop"
  iconUrl: string | null
  totalCount: number
  clipCount: number
  sessionCount: number
  screenshotCount: number
  totalSizeBytes: number
  latestAt: string
  items: RecordingLibraryItem[]
}

export interface RecordingLibrarySnapshot {
  outputFolder: string
  screenshotFolder: string
  scannedAt: string
  totalCount: number
  totalSizeBytes: number
  items: RecordingLibraryItem[]
  groups: RecordingLibraryGroup[]
  projectDrafts: RecordingLibraryProjectDraft[]
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
