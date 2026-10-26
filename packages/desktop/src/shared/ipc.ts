/**
 * IPC between the Electron main process and the two preload scripts. Both
 * sides ship in the same build, so this is private to the desktop package.
 * The contract the server-hosted web app sees is `AlloyTauriDesktop` in
 * `@alloy/contracts/desktop`; the server preload implements it on top of
 * these channels.
 */

/** Commands of the bundled connect screen. */
export const CONNECT_CHANNEL = "alloy:connect"
/** Window operations of the selected server window. */
export const SHELL_CHANNEL = "alloy:desktop-shell"
/** `servers.*`, `recording.*`, `updates.*` and `autostart.*` operations. */
export const API_CHANNEL = "alloy:desktop-api"
export const RECORDING_EVENT_CHANNEL = "alloy:recording"
export const UPDATES_EVENT_CHANNEL = "alloy:updates"

/**
 * Passed to the server window's renderer, so its preload installs the bridge
 * only on the server it was opened for.
 */
export const SELECTED_ORIGIN_ARGUMENT = "--alloy-selected-origin="

export const CONNECT_COMMANDS = [
  "connectServer",
  "connectReady",
  "cancelConnect",
  "savedServers",
  "forgetServer",
] as const
export type ConnectCommand = (typeof CONNECT_COMMANDS)[number]

export const SHELL_OPERATIONS = [
  "minimizeWindow",
  "toggleMaximizeWindow",
  "closeWindow",
  "openConnect",
  "openSettings",
  "openLogsFolder",
  "reloadApp",
] as const
export type ShellOperation = (typeof SHELL_OPERATIONS)[number]

/** A JSON value as the native code and the renderer exchange it. */
export type NativeJson =
  | string
  | number
  | boolean
  | null
  | NativeJson[]
  | { [key: string]: NativeJson }

/**
 * Every handler answers with this instead of throwing: Electron would wrap a
 * thrown error's message, and the renderer translates the message as is.
 */
export type IpcResult =
  | { ok: true; value: NativeJson | undefined }
  | { ok: false; error: string }

/** The connect screen's API, installed as `window.alloyConnect`. */
export interface AlloyConnectApi {
  connectServer(url: string): Promise<NativeJson | undefined>
  connectReady(): Promise<NativeJson | undefined>
  cancelConnect(): Promise<NativeJson | undefined>
  savedServers(): Promise<NativeJson | undefined>
  forgetServer(url: string): Promise<NativeJson | undefined>
}
