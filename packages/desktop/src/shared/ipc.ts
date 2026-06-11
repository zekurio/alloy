import type {
  ClipPrivacy,
  PublicAuthConfig,
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
  getRecordingStatus: "alloy:get-recording-status",
  getRecordingStorageInfo: "alloy:get-recording-storage-info",
  getRecordingLibrary: "alloy:get-recording-library",
  openRecordingLibraryFolder: "alloy:open-recording-library-folder",
  openRecordingLibraryCapture: "alloy:open-recording-library-capture",
  revealRecordingLibraryCapture: "alloy:reveal-recording-library-capture",
  exportRecordingLibraryCapture: "alloy:export-recording-library-capture",
  getRecordingLibraryCaptureKeyframes:
    "alloy:get-recording-library-capture-keyframes",
  updateRecordingLibraryCapture: "alloy:update-recording-library-capture",
  saveRecordingLibraryProjectDraft:
    "alloy:save-recording-library-project-draft",
  deleteRecordingLibraryProjectDraft:
    "alloy:delete-recording-library-project-draft",
  deleteRecordingLibraryCapture: "alloy:delete-recording-library-capture",
  importRecordingLibraryCapture: "alloy:import-recording-library-capture",
  recordingEvent: "alloy:recording-event",
  selectOutputFolder: "alloy:select-output-folder",
  listNotificationSounds: "alloy:list-notification-sounds",
  openNotificationSoundsFolder: "alloy:open-notification-sounds-folder",
  listGameProcesses: "alloy:list-game-processes",
  listRecordingDisplays: "alloy:list-recording-displays",
  saveReplayClip: "alloy:save-replay-clip",
  addRecordingBookmark: "alloy:add-recording-bookmark",
  takeRecordingScreenshot: "alloy:take-recording-screenshot",
  toggleLongRecording: "alloy:toggle-long-recording",
  stopRecording: "alloy:stop-recording",
  revealRecordingCapture: "alloy:reveal-recording-capture",
  minimizeWindow: "alloy:minimize-window",
  toggleMaximizeWindow: "alloy:toggle-maximize-window",
  closeWindow: "alloy:close-window",
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
  connect(url: string): Promise<ConnectResult>
  getStartupServer(): Promise<string | null>
  getServers(): Promise<SavedServer[]>
  forgetServer(url: string): Promise<SavedServer[]>
}

export interface AlloyDesktopServerApi {
  connect(url: string): Promise<ConnectResult>
  getServers(): Promise<SavedServer[]>
  getCurrentServer(): Promise<string | null>
  forgetServer(url: string): Promise<SavedServer[]>
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
  /** Opens a native folder picker; returns the chosen path or null if cancelled. */
  selectOutputFolder(): Promise<string | null>
  /** Returns running processes that can be added to the game allow list. */
  listGameProcesses(): Promise<RecordingGameProcess[]>
  /** Returns displays that can be selected for desktop capture. */
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
  /** Lists the audio files available in each event's notification sounds folder. */
  listNotificationSounds(): Promise<RecordingNotificationSoundLibrary>
  /** Opens the event's notification sounds folder so the user can add files. */
  openNotificationSoundsFolder(
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
