import type {
  DesktopConnectOptions,
  DesktopConnectResult,
  PublicAuthConfig,
} from "@alloy/contracts"

/**
 * Overlay-only IPC channel, deliberately outside the main window's native API.
 * Only the bundled connect screen may ask which server URL to pre-fill.
 */
export const OVERLAY_GET_STARTUP_SERVER_CHANNEL =
  "alloy:overlay.get-startup-server"

export const OVERLAY_GET_STARTUP_UPDATE_CHANNEL =
  "alloy:overlay.get-startup-update"
export const OVERLAY_RETRY_STARTUP_UPDATE_CHANNEL =
  "alloy:overlay.retry-startup-update"
export const OVERLAY_CONTINUE_STARTUP_CHANNEL = "alloy:overlay.continue-startup"
export const OVERLAY_OPEN_RELEASES_CHANNEL = "alloy:overlay.open-releases"
export const OVERLAY_STARTUP_UPDATE_EVENT_CHANNEL =
  "alloy:overlay.startup-update-state"

export type StartupUpdateState =
  | { phase: "inactive" }
  | { phase: "checking"; currentVersion: string }
  | { phase: "downloading"; currentVersion: string; version: string }
  | { phase: "installing"; currentVersion: string; version: string }
  | {
      phase: "error"
      currentVersion: string
      version: string | null
      message: string
      autoContinueAt: string | null
    }

/** Result of probing a candidate server URL for a valid Alloy endpoint. */
export type ProbeResult =
  | { ok: true; serverUrl: string; config: PublicAuthConfig }
  | { ok: false; error: string }

/**
 * The privileged native surface bridged into the bundled overlay renderer via
 * `contextBridge`.
 */
export interface AlloyNative {
  connect(
    url: string,
    options?: DesktopConnectOptions,
  ): Promise<DesktopConnectResult>
  getStartupServer(): Promise<string | null>
  getStartupUpdate(): Promise<StartupUpdateState>
  retryStartupUpdate(): Promise<void>
  continueStartup(): Promise<void>
  openReleases(): Promise<void>
  onStartupUpdate(listener: (state: StartupUpdateState) => void): () => void
}
