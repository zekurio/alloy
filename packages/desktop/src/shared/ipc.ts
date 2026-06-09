import type {
  PublicAuthConfig,
  RecordingActionResult,
  RecordingEvent,
  RecordingGameProcess,
  RecordingNotificationSoundEvent,
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
  selectNotificationSound: "alloy:select-notification-sound",
  listGameProcesses: "alloy:list-game-processes",
  saveReplayClip: "alloy:save-replay-clip",
  stopRecording: "alloy:stop-recording",
  revealRecordingCapture: "alloy:reveal-recording-capture",
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
  saveReplayClip(): Promise<RecordingActionResult>
  stopRecording(): Promise<RecordingActionResult>
  revealCapture(filename: string): Promise<void>
  /** Opens a native audio file picker and applies the chosen notification sound. */
  selectNotificationSound(
    sound: RecordingNotificationSoundEvent,
  ): Promise<string | null>
}

/**
 * Desktop bridge exposed to the configured Alloy web app. Native side effects
 * stay behind explicit IPC handlers; no raw Electron APIs reach the renderer.
 */
export interface AlloyDesktopMarker {
  platform: string
  titlebarOverlay: boolean
  openSettings(): Promise<void>
  servers: AlloyDesktopServerApi
  recording: AlloyDesktopRecordingApi
}
