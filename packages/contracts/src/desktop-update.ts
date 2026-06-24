/**
 * Auto-update state the desktop shell exposes to the web app over the
 * desktop bridge. This never goes through the server — an update is specific
 * to the machine running the desktop app.
 */
export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "downloaded"

export const DESKTOP_UPDATE_CHANNELS = ["latest", "unstable"] as const

export type DesktopUpdateChannel = (typeof DESKTOP_UPDATE_CHANNELS)[number]

export interface DesktopUpdateState {
  status: DesktopUpdateStatus
  /** Version currently running on this machine, e.g. "0.1.0". */
  currentVersion: string | null
  /** Version of the pending update once one is known, e.g. "0.2.0". */
  version: string | null
}

export function isDesktopUpdateChannel(
  value: unknown,
): value is DesktopUpdateChannel {
  return DESKTOP_UPDATE_CHANNELS.some((channel) => channel === value)
}

/** Desktop auto-update state and controls bridged into the web app. */
export interface AlloyDesktopUpdatesApi {
  getState(): Promise<DesktopUpdateState>
  getChannel?(): Promise<DesktopUpdateChannel>
  setChannel?(channel: DesktopUpdateChannel): Promise<DesktopUpdateChannel>
  /** Runs an immediate update check instead of waiting for the background interval. */
  checkForUpdates?(): Promise<DesktopUpdateState>
  /** Quits and installs the downloaded update; no-op when none is ready. */
  restartToInstall(): Promise<void>
  onState(listener: (state: DesktopUpdateState) => void): () => void
}
