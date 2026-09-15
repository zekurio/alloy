import { z } from "zod"

import type {
  AlloyDesktopRecordingApi,
  DesktopSavedServer,
} from "./desktop-api"
import type { AlloyDesktopAutostartApi } from "./desktop-autostart"
import type { AlloyDesktopUpdatesApi } from "./desktop-update"

/** Exact contract for the Tauri host's server-hosted renderer. */
export const TAURI_DESKTOP_BRIDGE_CONTRACT_1 = 1 as const
export const TAURI_DESKTOP_BRIDGE_CONTRACT_IDS = Object.freeze([
  TAURI_DESKTOP_BRIDGE_CONTRACT_1,
] as const)

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
      httpContract: z.number().int().positive(),
      bridgeContract: z.number().int().positive(),
    }),
  )
  .max(8)

/**
 * Server management from inside the selected server's web app. Every call
 * rejects with a user-facing message on failure. A successful `connect`
 * replaces the calling window with the new server's window.
 */
export interface AlloyTauriDesktopServerApi {
  connect(url: string): Promise<DesktopTauriConnectResult>
  getServers(): Promise<DesktopSavedServer[]>
  getCurrentServer(): Promise<string>
  forgetServer(url: string): Promise<DesktopSavedServer[]>
}

/** Native operations granted to the selected server's web app. */
export interface AlloyTauriDesktop {
  bridgeContract: typeof TAURI_DESKTOP_BRIDGE_CONTRACT_1
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  openConnect(): Promise<void>
  openSettings(): Promise<void>
  reloadApp(): Promise<void>
  servers: AlloyTauriDesktopServerApi
  recording: AlloyDesktopRecordingApi
  updates: AlloyDesktopUpdatesApi
  autostart: AlloyDesktopAutostartApi
}
