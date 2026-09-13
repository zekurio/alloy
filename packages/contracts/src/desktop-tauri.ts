import { z } from "zod"

import type { AlloyDesktopRecordingApi } from "./desktop-api"
import type { AlloyDesktopAutostartApi } from "./desktop-autostart"
import type { AlloyDesktopUpdatesApi } from "./desktop-update"

/** Exact contract for the Tauri host's server-hosted renderer. */
export const TAURI_DESKTOP_BRIDGE_CONTRACT_1 = 1 as const
export const TAURI_DESKTOP_BRIDGE_CONTRACT_IDS = Object.freeze([
  TAURI_DESKTOP_BRIDGE_CONTRACT_1,
] as const)

/** Only the local connection screen receives this result. */
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

/** Native operations granted to the selected server's web app. */
export interface AlloyTauriDesktop {
  bridgeContract: typeof TAURI_DESKTOP_BRIDGE_CONTRACT_1
  titlebarOverlay: boolean
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  openConnect(): Promise<void>
  openSettings(): Promise<void>
  reloadApp(): Promise<void>
  recording: AlloyDesktopRecordingApi
  updates: AlloyDesktopUpdatesApi
  autostart: AlloyDesktopAutostartApi
}
