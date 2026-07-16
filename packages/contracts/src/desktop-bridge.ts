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

/**
 * Single source of truth for the `window.alloyDesktop` bridge the desktop
 * shell exposes to the server-hosted web app.
 *
 * The bridge is the only compatibility surface between the two: IPC channel
 * names and preload internals ship inside one desktop binary and may change
 * freely, but the JS shape below is consumed by whatever web app version the
 * connected server serves.
 *
 * Compatibility policy — the bridge is ADDITIVE-ONLY:
 * - Never remove a shipped member or change its signature or semantics.
 * - New members get `since: DESKTOP_BRIDGE_VERSION + 1` and the version
 *   constant is bumped in the same change.
 * - The web app gates on `bridge.version` via {@link desktopBridgeSupports};
 *   it must never sniff members with `typeof` checks.
 */
export const DESKTOP_BRIDGE_VERSION = 1

/** Handshake info exposed as `alloyDesktop.bridge`. */
export interface AlloyDesktopBridgeInfo {
  /** Bridge contract version; compare via {@link desktopBridgeSupports}. */
  version: number
  /** Desktop app version running this shell, e.g. "1.4.0". */
  appVersion: string
}

export type DesktopConnectResult =
  | { ok: true; serverUrl: string }
  | { ok: false; error: string }

export interface DesktopConnectOptions {
  forceBrowserLogin?: boolean
}

export interface DesktopSavedServer {
  serverUrl: string
  lastConnectedAt: string
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

/**
 * The desktop bridge exposed to the configured Alloy web app as
 * `window.alloyDesktop`. Native side effects stay behind explicit IPC
 * handlers; no raw Electron APIs reach the renderer.
 */
export interface AlloyDesktop {
  bridge: AlloyDesktopBridgeInfo
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

export interface DesktopBridgeMethodMeta {
  /** Bridge version this member first shipped in. */
  since: number
  /** Push-event subscription (listener in, unsubscribe out), not an invoke. */
  event?: true
}

type DesktopBridgeApiMeta<T> = {
  [K in keyof T]-?: T[K] extends (...args: never[]) => unknown
    ? DesktopBridgeMethodMeta
    : DesktopBridgeApiMeta<T[K]>
}

/**
 * Invokable bridge members. Drives the desktop preload (channel wiring), the
 * main process handler map (exhaustiveness), and web-side version gating.
 * `bridge` and `titlebarOverlay` are preload-provided values, not channels.
 */
export const DESKTOP_BRIDGE = {
  minimizeWindow: { since: 1 },
  toggleMaximizeWindow: { since: 1 },
  closeWindow: { since: 1 },
  openConnect: { since: 1 },
  openSettings: { since: 1 },
  reloadApp: { since: 1 },
  servers: {
    connect: { since: 1 },
    getServers: { since: 1 },
    getCurrentServer: { since: 1 },
    forgetServer: { since: 1 },
  },
  recording: {
    getSettings: { since: 1 },
    setSettings: { since: 1 },
    restartBackend: { since: 1 },
    getStatus: { since: 1 },
    getStorageInfo: { since: 1 },
    getLibrary: { since: 1 },
    revealLibraryCapture: { since: 1 },
    exportLibraryCapture: { since: 1 },
    updateLibraryCapture: { since: 1 },
    deleteLibraryCapture: { since: 1 },
    importLibraryFiles: { since: 1 },
    commitStagedLibraryImport: { since: 1 },
    discardStagedLibraryImport: { since: 1 },
    saveLibraryCaptureThumbnail: { since: 1 },
    downloadClip: { since: 1 },
    cancelClipDownload: { since: 1 },
    listClipDownloads: { since: 1 },
    onEvent: { since: 1, event: true },
    selectOutputFolder: { since: 1 },
    listGameProcesses: { since: 1 },
    listDisplays: { since: 1 },
    subscribeAudioLevels: { since: 1 },
    stopAudioLevels: { since: 1 },
    listNotificationSounds: { since: 1 },
    openNotificationSoundsFolder: { since: 1 },
    previewNotificationSound: { since: 1 },
  },
  updates: {
    getState: { since: 1 },
    checkForUpdates: { since: 1 },
    downloadUpdate: { since: 1 },
    restartToInstall: { since: 1 },
    onState: { since: 1, event: true },
  },
  autostart: {
    getState: { since: 1 },
    setEnabled: { since: 1 },
  },
  notifications: {
    show: { since: 1 },
  },
} as const satisfies DesktopBridgeApiMeta<
  Omit<AlloyDesktop, "bridge" | "titlebarOverlay">
>

type BridgePathsOf<T> = {
  [K in keyof T & string]: T[K] extends DesktopBridgeMethodMeta
    ? K
    : `${K}.${BridgePathsOf<T[K]>}`
}[keyof T & string]

/** Dotted path of an invokable bridge member, e.g. "recording.getSettings". */
export type DesktopBridgePath = BridgePathsOf<typeof DESKTOP_BRIDGE>

function flattenBridge(
  tree: Record<string, unknown>,
  prefix: string,
  into: Record<string, DesktopBridgeMethodMeta>,
): Record<string, DesktopBridgeMethodMeta> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof (value as DesktopBridgeMethodMeta).since === "number") {
      into[path] = value as DesktopBridgeMethodMeta
      continue
    }
    flattenBridge(value as Record<string, unknown>, path, into)
  }
  return into
}

/** Flat path → metadata view of {@link DESKTOP_BRIDGE}. */
export const DESKTOP_BRIDGE_METHODS = flattenBridge(
  DESKTOP_BRIDGE,
  "",
  {},
) as Record<DesktopBridgePath, DesktopBridgeMethodMeta>

/**
 * IPC channel backing a bridge member. Internal to the desktop binary
 * (preload + main ship together); never referenced by the web app.
 */
export function desktopBridgeChannel(path: DesktopBridgePath): string {
  return `alloy:${path}`
}

/** Whether a shell reporting `version` implements the member at `path`. */
export function desktopBridgeSupports(
  version: number,
  path: DesktopBridgePath,
): boolean {
  return version >= DESKTOP_BRIDGE_METHODS[path].since
}
