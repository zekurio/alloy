import { TAURI_DESKTOP_BRIDGE_CONTRACT_1 } from "@alloy/primitives"
import { z } from "zod"

import type {
  AlloyDesktopRecordingApi,
  DesktopSavedServer,
} from "./desktop-api"
import type { AlloyDesktopAutostartApi } from "./desktop-autostart"
import type { AlloyDesktopUpdatesApi } from "./desktop-update"

/** Returned by the local connection screen and the in-app server switch. */
export const DesktopTauriConnectResultSchema = z.object({
  serverUrl: z.url(),
})

export type DesktopTauriConnectResult = z.infer<
  typeof DesktopTauriConnectResultSchema
>

/** Tauri rejects native commands with a user-facing error message. */
export const DesktopTauriErrorSchema = z.string().trim().min(1)

export const DesktopTauriSavedServersSchema = z
  .array(
    z.object({
      serverUrl: z.url(),
      lastConnectedAt: z.iso.datetime({ offset: true }),
      serverVersion: z.string().trim().min(1).optional(),
      httpContract: z.number().int().positive(),
      bridgeContract: z.number().int().positive(),
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
