import { DESKTOP_BRIDGE_CONTRACT_1 } from "@alloy/primitives"

import type {
  AlloyDesktopRecordingApi,
  DesktopSavedServer,
} from "./desktop-api"
import type { AlloyDesktopAutostartApi } from "./desktop-autostart"
import type { AlloyDesktopUpdatesApi } from "./desktop-update"
import { isStringValue } from "./object"
import { t } from "./schema"

/** Returned by the local connection screen and the in-app server switch. */
export const DesktopConnectResultSchema = t.object({
  serverUrl: t.url(),
})

export type DesktopConnectResult = t.infer<typeof DesktopConnectResultSchema>

/**
 * The desktop host rejects native commands with a user-facing error message.
 * Only strings qualify; `t.string()` alone would coerce `null` or a number
 * into one.
 */
export const DesktopErrorMessageSchema = t.preprocess(
  (value) => (isStringValue(value) ? value : undefined),
  t.string().trim().min(1),
)

export const DesktopSavedServersSchema = t
  .array(
    t.object({
      serverUrl: t.url(),
      lastConnectedAt: t.iso.datetime({ offset: true }),
      serverVersion: t.string().trim().min(1),
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
export interface AlloyDesktopServerApi {
  switchTo(url: string): Promise<DesktopConnectResult>
  list(): Promise<DesktopSavedServer[]>
  current(): Promise<string>
  forget(url: string): Promise<DesktopSavedServer[]>
}

/** Native operations granted to the selected server's web app. */
export interface AlloyDesktop {
  bridgeContract: typeof DESKTOP_BRIDGE_CONTRACT_1
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  openConnect(): Promise<void>
  openSettings(): Promise<void>
  /** Handles native settings requests without reloading. */
  onOpenSettings(listener: () => void): () => void
  /** Opens the host's log directory. Rejects if logging could not start. */
  openLogsFolder(): Promise<void>
  reloadApp(): Promise<void>
  servers: AlloyDesktopServerApi
  recording: AlloyDesktopRecordingApi
  updates: AlloyDesktopUpdatesApi
  autostart: AlloyDesktopAutostartApi
}
