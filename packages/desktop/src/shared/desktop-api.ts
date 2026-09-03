import type { AlloyDesktop } from "@alloy/contracts"

export type DesktopApiOperationMeta =
  | { readonly kind: "invoke" }
  | { readonly kind: "event" }

type DesktopApiTreeMeta<T> = {
  [K in keyof T]-?: T[K] extends (...args: never[]) => infer _Result
    ? DesktopApiOperationMeta
    : DesktopApiTreeMeta<T[K]>
}

/**
 * Operation wiring for the lockstep desktop API. The preload uses this tree to
 * generate methods, and the main process uses it to require an exhaustive
 * invoke handler map. `bridgeContract` and `titlebarOverlay` are
 * preload-provided values.
 */
export const DESKTOP_API_OPERATIONS = {
  minimizeWindow: { kind: "invoke" },
  toggleMaximizeWindow: { kind: "invoke" },
  closeWindow: { kind: "invoke" },
  openConnect: { kind: "invoke" },
  openSettings: { kind: "invoke" },
  reloadApp: { kind: "invoke" },
  servers: {
    connect: { kind: "invoke" },
    getServers: { kind: "invoke" },
    getCurrentServer: { kind: "invoke" },
    forgetServer: { kind: "invoke" },
  },
  recording: {
    getSettings: { kind: "invoke" },
    setSettings: { kind: "invoke" },
    restartBackend: { kind: "invoke" },
    getStatus: { kind: "invoke" },
    getStorageInfo: { kind: "invoke" },
    getLibrary: { kind: "invoke" },
    revealLibraryCapture: { kind: "invoke" },
    exportLibraryCapture: { kind: "invoke" },
    updateLibraryCapture: { kind: "invoke" },
    setLibraryCaptureTrim: { kind: "invoke" },
    deleteLibraryCapture: { kind: "invoke" },
    importLibraryFiles: { kind: "invoke" },
    commitStagedLibraryImport: { kind: "invoke" },
    discardStagedLibraryImport: { kind: "invoke" },
    saveLibraryCaptureThumbnail: { kind: "invoke" },
    downloadClip: { kind: "invoke" },
    cancelClipDownload: { kind: "invoke" },
    listClipDownloads: { kind: "invoke" },
    onEvent: { kind: "event" },
    selectOutputFolder: { kind: "invoke" },
    listGameProcesses: { kind: "invoke" },
    listDisplays: { kind: "invoke" },
    subscribeAudioLevels: { kind: "invoke" },
    stopAudioLevels: { kind: "invoke" },
    listNotificationSounds: { kind: "invoke" },
    openNotificationSoundsFolder: { kind: "invoke" },
    previewNotificationSound: { kind: "invoke" },
  },
  updates: {
    getState: { kind: "invoke" },
    checkForUpdates: { kind: "invoke" },
    downloadUpdate: { kind: "invoke" },
    restartToInstall: { kind: "invoke" },
    onState: { kind: "event" },
  },
  autostart: {
    getState: { kind: "invoke" },
    setEnabled: { kind: "invoke" },
  },
  notifications: {
    show: { kind: "invoke" },
  },
} as const satisfies DesktopApiTreeMeta<
  Omit<AlloyDesktop, "bridgeContract" | "titlebarOverlay">
>

type ApiPathsOf<T> = {
  [K in keyof T & string]: T[K] extends DesktopApiOperationMeta
    ? K
    : `${K}.${ApiPathsOf<T[K]>}`
}[keyof T & string]

/** Dotted path of one lockstep native operation. */
export type DesktopApiPath = ApiPathsOf<typeof DESKTOP_API_OPERATIONS>

/** Private IPC channel for one lockstep renderer/preload/main operation. */
export function desktopApiChannel(path: DesktopApiPath): string {
  return `alloy:${path}`
}
