import type {
  DesktopConnectOptions,
  DesktopConnectResult,
  PublicAuthConfig,
} from "@alloy/contracts"

/**
 * Overlay-only IPC channel, deliberately outside the web bridge contract
 * (`DESKTOP_BRIDGE` in @alloy/contracts): only the bundled connect screen may
 * ask which server URL to pre-fill.
 */
export const OVERLAY_GET_STARTUP_SERVER_CHANNEL =
  "alloy:overlay.get-startup-server"

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
}
