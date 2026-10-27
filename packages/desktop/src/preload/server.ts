import type { AlloyDesktopRecordingApi } from "@alloy/contracts/desktop-api"
import type { AlloyDesktop } from "@alloy/contracts/desktop-bridge"
import type { RecordingEvent } from "@alloy/contracts/desktop-recording-types"
import type { DesktopUpdateState } from "@alloy/contracts/desktop-update"
import { DESKTOP_BRIDGE_CONTRACT_1 } from "@alloy/primitives"
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

import {
  API_CHANNEL,
  RECORDING_EVENT_CHANNEL,
  SELECTED_ORIGIN_ARGUMENT,
  SHELL_CHANNEL,
  UPDATES_EVENT_CHANNEL,
  type IpcResult,
  type NativeJson,
  type ShellOperation,
} from "../shared/ipc"

// Installs bridge contract 1 for the selected server's web app, which reads
// it from `window.alloyDesktop`. The main process checks the sender and its
// origin on every call; this check only keeps the bridge off pages that could
// never use it.

const selectedOrigin = process.argv
  .find((argument) => argument.startsWith(SELECTED_ORIGIN_ARGUMENT))
  ?.slice(SELECTED_ORIGIN_ARGUMENT.length)

async function settle(
  pending: Promise<IpcResult>,
): Promise<NativeJson | undefined> {
  const result = await pending
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const shell = async (operation: ShellOperation): Promise<void> => {
  await settle(ipcRenderer.invoke(SHELL_CHANNEL, operation))
}

const call = (operation: string, ...args: NativeJson[]) =>
  settle(ipcRenderer.invoke(API_CHANNEL, operation, args))

function onRecordingEvent(
  listener: (event: RecordingEvent) => void,
): () => void {
  const handle = (_event: IpcRendererEvent, payload: RecordingEvent) =>
    listener(payload)
  ipcRenderer.on(RECORDING_EVENT_CHANNEL, handle)
  return () => {
    ipcRenderer.off(RECORDING_EVENT_CHANNEL, handle)
  }
}

function onUpdateState(
  listener: (state: DesktopUpdateState) => void,
): () => void {
  const handle = (_event: IpcRendererEvent, payload: DesktopUpdateState) =>
    listener(payload)
  ipcRenderer.on(UPDATES_EVENT_CHANNEL, handle)
  return () => {
    ipcRenderer.off(UPDATES_EVENT_CHANNEL, handle)
  }
}

const RECORDING_METHODS = [
  "getSettings",
  "setSettings",
  "restartBackend",
  "getStatus",
  "getStorageInfo",
  "getLibrary",
  "revealLibraryCapture",
  "exportLibraryCapture",
  "releaseLibraryExport",
  "updateLibraryCapture",
  "setLibraryCaptureTrim",
  "deleteLibraryCapture",
  "importLibraryFile",
  "commitStagedLibraryImport",
  "discardStagedLibraryImport",
  "downloadClip",
  "cancelClipDownload",
  "listClipDownloads",
  "selectOutputFolder",
  "listGameProcesses",
  "listDisplays",
  "subscribeAudioLevels",
  "stopAudioLevels",
  "listNotificationSounds",
  "openNotificationSoundsFolder",
  "previewNotificationSound",
  "getShortcuts",
  "bindShortcuts",
  "configureShortcuts",
] as const satisfies readonly Exclude<
  keyof AlloyDesktopRecordingApi,
  "onEvent"
>[]

function recordingApi(): AlloyDesktopRecordingApi {
  const methods = Object.fromEntries(
    RECORDING_METHODS.map((method) => [
      method,
      (...args: NativeJson[]) => call(`recording.${method}`, ...args),
    ]),
  )
  // SAFETY: Every method of the contract except `onEvent` is in
  // RECORDING_METHODS, and the main process returns each one's result type.
  return {
    ...methods,
    onEvent: onRecordingEvent,
  } as AlloyDesktopRecordingApi
}

function bridge(): AlloyDesktop {
  // SAFETY: The main process answers each operation with its contract type.
  const typed = <T>(pending: Promise<NativeJson | undefined>) =>
    pending as Promise<T>
  return {
    bridgeContract: DESKTOP_BRIDGE_CONTRACT_1,
    minimizeWindow: () => shell("minimizeWindow"),
    toggleMaximizeWindow: () => shell("toggleMaximizeWindow"),
    closeWindow: () => shell("closeWindow"),
    openConnect: () => shell("openConnect"),
    openSettings: () => shell("openSettings"),
    onOpenSettings: (listener) => {
      // The main process dispatches this cancelable event in the page; a
      // handled event keeps it from navigating to the settings URL.
      const handle = (event: Event) => {
        event.preventDefault()
        listener()
      }
      window.addEventListener("alloy:open-settings", handle)
      return () => window.removeEventListener("alloy:open-settings", handle)
    },
    openLogsFolder: () => shell("openLogsFolder"),
    reloadApp: () => shell("reloadApp"),
    servers: {
      switchTo: (url) => typed(call("servers.switchTo", url)),
      list: () => typed(call("servers.list")),
      current: () => typed(call("servers.current")),
      forget: (url) => typed(call("servers.forget", url)),
    },
    recording: recordingApi(),
    updates: {
      getState: () => typed(call("updates.getState")),
      checkForUpdates: () => typed(call("updates.checkForUpdates")),
      downloadUpdate: () => typed(call("updates.downloadUpdate")),
      restartToInstall: () => typed(call("updates.restartToInstall")),
      onState: onUpdateState,
    },
    autostart: {
      getState: () => typed(call("autostart.getState")),
      setEnabled: (enabled) => typed(call("autostart.setEnabled", enabled)),
    },
  }
}

if (
  selectedOrigin &&
  window.top === window &&
  window.location.origin === selectedOrigin
) {
  contextBridge.exposeInMainWorld("alloyDesktop", bridge())
}
