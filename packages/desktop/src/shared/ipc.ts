import type {
  PublicAuthConfig,
  RecordingActionResult,
  RecordingActionRequest,
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
  getStartupServer: "alloy:get-startup-server",
  getServers: "alloy:get-servers",
  getCurrentServer: "alloy:get-current-server",
  forgetServer: "alloy:forget-server",
  openSettings: "alloy:open-settings",
  getRecordingSettings: "alloy:get-recording-settings",
  setRecordingSettings: "alloy:set-recording-settings",
  getRecordingStatus: "alloy:get-recording-status",
  getRecordingStorageInfo: "alloy:get-recording-storage-info",
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
  openSettings(): Promise<void>
  servers: AlloyDesktopServerApi
  recording: AlloyDesktopRecordingApi
}
