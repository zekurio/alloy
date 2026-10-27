import type {
  RecordingGameProcess,
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundLibrary,
  RecordingSettings,
  RecordingStatus,
  RecordingStorageInfo,
} from "@alloy/contracts/desktop"
import { t } from "@alloy/i18n"
import { Callout } from "@alloy/ui/components/callout"
import { useQueryClient } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { CircleAlertIcon } from "lucide-react"
import { createContext, useContext, useState } from "react"
import type { ReactNode } from "react"
import { useStore } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { createStore } from "zustand/vanilla"
import type { StoreApi } from "zustand/vanilla"

import {
  confirmRecordingSettings,
  saveRecordingSettings,
  setRecordingStatus,
  useRecordingSyncState,
  useRetainRecordingSync,
} from "@/components/layout/use-desktop-recording-state"
import { alloyDesktop } from "@/lib/desktop"
import type { AlloyDesktopRecordingApi } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"
import { desktopQueryKey, useDesktopQuery } from "@/lib/use-desktop-query"

/**
 * Operations that report failures. Each keeps its own slot so one failing
 * (say, a sound preview) neither clears nor shows up as another's error.
 */
export type RecordingErrorScope =
  | "save"
  | "folder"
  | "restart"
  | "sounds"
  | "games"

/** Scopes every recording panel shows: the shared settings write. */
const SETTINGS_ERROR_SCOPES: readonly RecordingErrorScope[] = ["save"]

const STORAGE_INFO_KEY = ["recording", "storage"]

/** State and operations the desktop settings panels share while open. */
interface DesktopRecordingPanelState {
  restarting: boolean
  /** Latest failure of each operation, cleared when it next runs. */
  errors: Partial<Record<RecordingErrorScope, string>>
  /** Persist the given settings to the desktop shell. */
  save: (next: RecordingSettings) => Promise<void>
  /** Restart the capture sidecar process and refresh status. */
  restartBackend: () => Promise<void>
  /** Open the native folder picker and apply the chosen capture folder. */
  chooseOutputFolder: () => Promise<void>
  /** List the audio files available in the shared notification sounds folder. */
  listNotificationSounds: () => Promise<RecordingNotificationSoundLibrary>
  /** Open the shared notification sounds folder so the user can add files. */
  openNotificationSoundsFolder: (
    sound: RecordingNotificationSoundEvent,
  ) => Promise<void>
  /** Play an event's configured sound once so the user can audition it. */
  previewNotificationSound: (
    sound: RecordingNotificationSoundEvent,
  ) => Promise<void>
  /** Return running processes that can be added to the game allow list. */
  listGameProcesses: () => Promise<RecordingGameProcess[]>
}

interface DesktopRecordingContextValue extends DesktopRecordingPanelState {
  settings: RecordingSettings | null
  status: RecordingStatus | null
  storageInfo: RecordingStorageInfo | null
  busy: boolean
  /** Failure to load settings at all; panels can't render without them. */
  error: string | null
}

export const EMPTY_SOUND_LIBRARY: RecordingNotificationSoundLibrary = {
  replayBufferStarted: [],
  clipSaved: [],
}

function createRecordingPanelStore(
  recording: AlloyDesktopRecordingApi | null,
  queryClient: QueryClient,
) {
  return createStore<DesktopRecordingPanelState>()((set) => {
    const setScopeError = (
      scope: RecordingErrorScope,
      message: string | null,
    ) => {
      set((current) => {
        if ((current.errors[scope] ?? null) === message) return current
        const errors = { ...current.errors }
        if (message === null) delete errors[scope]
        else errors[scope] = message
        return { errors }
      })
    }

    return {
      restarting: false,
      errors: {},

      save: async (next) => {
        if (!recording) return
        setScopeError("save", null)
        try {
          await saveRecordingSettings(recording, next)
        } catch (cause) {
          setScopeError(
            "save",
            errorMessage(cause, t("Couldn't save recording settings.")),
          )
        }
      },

      chooseOutputFolder: async () => {
        if (!recording) return
        setScopeError("folder", null)
        try {
          // The host applies the picked folder itself.
          const folder = await recording.selectOutputFolder()
          if (!folder) return
          confirmRecordingSettings(await recording.getSettings())
          queryClient.setQueryData(
            desktopQueryKey(STORAGE_INFO_KEY),
            await recording.getStorageInfo(),
          )
        } catch (cause) {
          setScopeError(
            "folder",
            errorMessage(cause, t("Couldn't change the capture folder.")),
          )
        }
      },

      restartBackend: async () => {
        if (!recording) return
        setScopeError("restart", null)
        set({ restarting: true })
        try {
          setRecordingStatus(await recording.restartBackend())
        } catch (cause) {
          setScopeError(
            "restart",
            errorMessage(cause, t("Couldn't restart Alloy agent.")),
          )
          throw cause
        } finally {
          set({ restarting: false })
        }
      },

      listNotificationSounds: async () => {
        if (!recording) return EMPTY_SOUND_LIBRARY
        setScopeError("sounds", null)
        try {
          return await recording.listNotificationSounds()
        } catch (cause) {
          setScopeError(
            "sounds",
            errorMessage(cause, t("Couldn't load notification sounds.")),
          )
          return EMPTY_SOUND_LIBRARY
        }
      },

      openNotificationSoundsFolder: async (sound) => {
        if (!recording) return
        setScopeError("sounds", null)
        try {
          await recording.openNotificationSoundsFolder(sound)
        } catch (cause) {
          setScopeError(
            "sounds",
            errorMessage(cause, t("Couldn't open the sounds folder.")),
          )
        }
      },

      previewNotificationSound: async (sound) => {
        if (!recording) return
        setScopeError("sounds", null)
        try {
          await recording.previewNotificationSound(sound)
        } catch (cause) {
          setScopeError(
            "sounds",
            errorMessage(cause, t("Couldn't play the sound.")),
          )
        }
      },

      listGameProcesses: async () => {
        if (!recording) return []
        setScopeError("games", null)
        try {
          return await recording.listGameProcesses()
        } catch (cause) {
          setScopeError(
            "games",
            errorMessage(cause, t("Couldn't load running processes.")),
          )
          return []
        }
      },
    }
  })
}

const DesktopRecordingContext =
  createContext<StoreApi<DesktopRecordingPanelState> | null>(null)

function useStorageInfo(recording: AlloyDesktopRecordingApi | null) {
  return useDesktopQuery(
    STORAGE_INFO_KEY,
    recording ? () => recording.getStorageInfo() : null,
  )
}

/**
 * Keeps the desktop recording settings, capture status and storage info
 * loaded around the desktop settings panels, so switching between Capture and
 * Clips keeps the loaded state (and any in-flight save) instead of refetching.
 * Operation errors live as long as this provider.
 */
export function DesktopRecordingProvider({
  children,
}: {
  children: ReactNode
}) {
  const recording = alloyDesktop()?.recording ?? null
  const queryClient = useQueryClient()
  const [store] = useState(() =>
    createRecordingPanelStore(recording, queryClient),
  )
  useRetainRecordingSync(recording)
  useStorageInfo(recording)

  return (
    <DesktopRecordingContext.Provider value={store}>
      {children}
    </DesktopRecordingContext.Provider>
  )
}

function usePanelStore(): StoreApi<DesktopRecordingPanelState> {
  const store = useContext(DesktopRecordingContext)
  if (!store) {
    throw new Error(
      "useDesktopRecording must be used within a DesktopRecordingProvider",
    )
  }
  return store
}

/** One piece of the panel state, for readers that don't need the settings. */
export function useDesktopRecordingPanel<T>(
  selector: (state: DesktopRecordingPanelState) => T,
): T {
  return useStore(usePanelStore(), selector)
}

export function useDesktopRecording(): DesktopRecordingContextValue {
  const recording = alloyDesktop()?.recording ?? null
  const panel = useDesktopRecordingPanel(useShallow((state) => state))
  const sync = useRecordingSyncState(recording)
  const storage = useStorageInfo(recording)
  const failedLoad = sync.loadError ?? storage.error

  return {
    ...panel,
    settings: sync.settings,
    status: sync.status,
    storageInfo: storage.data ?? null,
    busy: sync.loading || storage.loading || panel.restarting,
    error: failedLoad
      ? errorMessage(failedLoad, t("Couldn't load recording settings."))
      : null,
  }
}

/**
 * Shows the load failure, then the first failed operation among `scopes`,
 * then the capture status message. Panels pass the operations they own so a
 * failure elsewhere doesn't show up on them.
 */
export function DesktopRecordingNotice({
  scopes = SETTINGS_ERROR_SCOPES,
}: {
  scopes?: readonly RecordingErrorScope[]
}) {
  const { error: loadError, errors, status } = useDesktopRecording()
  const error =
    loadError ??
    scopes.map((scope) => errors[scope]).find((message) => message) ??
    null
  const statusMessage = status?.message?.trim()
  const message = error ?? (statusMessage ? t(statusMessage) : null)
  if (!message) return null
  return (
    <Callout
      tone={!error && status?.backend === "missing" ? "warning" : "destructive"}
    >
      <CircleAlertIcon />
      <span>{message}</span>
    </Callout>
  )
}
