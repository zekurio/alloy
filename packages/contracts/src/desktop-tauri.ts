import { TAURI_DESKTOP_BRIDGE_CONTRACT_1 } from "@alloy/primitives"

import type {
  AlloyDesktopRecordingApi,
  DesktopSavedServer,
} from "./desktop-api"
import type { AlloyDesktopAutostartApi } from "./desktop-autostart"
import type { AlloyDesktopUpdatesApi } from "./desktop-update"
import { t } from "./schema"

/** Returned by the local connection screen and the in-app server switch. */
export const DesktopTauriConnectResultSchema = t.object({
  serverUrl: t.url(),
})

export type DesktopTauriConnectResult = t.infer<
  typeof DesktopTauriConnectResultSchema
>

/** Tauri rejects native commands with a user-facing error message. */
export const DesktopTauriErrorSchema = t.string().trim().min(1)

export const DesktopTauriSavedServersSchema = t
  .array(
    t.object({
      serverUrl: t.url(),
      lastConnectedAt: t.iso.datetime({ offset: true }),
      serverVersion: t.string().trim().min(1).optional(),
      httpContract: t.number().int().positive(),
      bridgeContract: t.number().int().positive(),
    }),
  )
  .max(8)

/**
 * Server management from inside the selected server's web app. Every call
 * rejects with a user-facing message on failure. A successful `switchTo`
 * replaces the calling window with the new server's window.
 */
export interface AlloyTauriDesktopServerApi {
  switchTo(url: string): Promise<DesktopTauriConnectResult>
  list(): Promise<DesktopSavedServer[]>
  current(): Promise<string>
  forget(url: string): Promise<DesktopSavedServer[]>
}

/** Native operations granted to the selected server's web app. */
export interface AlloyTauriDesktop {
  bridgeContract: typeof TAURI_DESKTOP_BRIDGE_CONTRACT_1
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  openConnect(): Promise<void>
  openSettings(): Promise<void>
  /** Handles native settings requests without reloading. Absent on older hosts. */
  onOpenSettings?(listener: () => void): () => void
  /**
   * Opens the host's log directory. Rejects if logging could not start.
   * Absent on older contract-1 hosts.
   */
  openLogsFolder?(): Promise<void>
  reloadApp(): Promise<void>
  servers: AlloyTauriDesktopServerApi
  recording: AlloyDesktopRecordingApi
  updates: AlloyDesktopUpdatesApi
  autostart: AlloyDesktopAutostartApi
}
