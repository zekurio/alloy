import type {
  RecordingDisplay,
  RecordingGameProcess,
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundLibrary,
  RecordingSettings,
  RecordingStatus,
  RecordingStorageInfo,
} from "@alloy/desktop-contracts"
import { t } from "@alloy/i18n"
import { Callout } from "@alloy/ui/components/callout"
import { CircleAlertIcon } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"
import type { ReactNode } from "react"

import { useRecordingSync } from "@/components/layout/use-desktop-recording-state"
import { alloyDesktop } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"
import { useDesktopQuery } from "@/lib/use-desktop-query"

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
  | "displays"

/** Scopes every recording panel shows: the shared settings write. */
const SETTINGS_ERROR_SCOPES: readonly RecordingErrorScope[] = ["save"]

interface DesktopRecordingContextValue {
  settings: RecordingSettings | null
  status: RecordingStatus | null
  storageInfo: RecordingStorageInfo | null
  busy: boolean
  /** Failure to load settings at all; panels can't render without them. */
  error: string | null
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
  /** Return displays that can be selected for desktop capture. */
  listDisplays: () => Promise<RecordingDisplay[]>
}

export const EMPTY_SOUND_LIBRARY: RecordingNotificationSoundLibrary = {
  replayBufferStarted: [],
  clipSaved: [],
}

const DesktopRecordingContext =
  createContext<DesktopRecordingContextValue | null>(null)

/**
 * Loads and owns the desktop recording settings + capture status. Mounted once
 * around the desktop settings panels so switching between Capture and Clips
 * keeps the loaded state (and any in-flight save) instead of refetching.
 */
export function DesktopRecordingProvider({
  children,
}: {
  children: ReactNode
}) {
  const recording = alloyDesktop()?.recording ?? null
  const {
    settings,
    status,
    setStatus,
    loading,
    loadError,
    confirmSettings,
    save: saveSettings,
  } = useRecordingSync(recording)
  const {
    data: storageInfo,
    setData: setStorageInfo,
    loading: storageLoading,
    error: storageError,
  } = useDesktopQuery(recording ? () => recording.getStorageInfo() : null, [
    recording,
  ])
  const [restarting, setRestarting] = useState(false)
  const [errors, setErrors] = useState<
    Partial<Record<RecordingErrorScope, string>>
  >({})
  const failedLoad = loadError ?? storageError
  const error = failedLoad
    ? errorMessage(failedLoad, t("Couldn't load recording settings."))
    : null

  const setScopeError = useCallback(
    (scope: RecordingErrorScope, message: string | null) => {
      setErrors((current) => {
        if ((current[scope] ?? null) === message) return current
        const next = { ...current }
        if (message === null) delete next[scope]
        else next[scope] = message
        return next
      })
    },
    [],
  )

  const save = useCallback(
    async (next: RecordingSettings) => {
      setScopeError("save", null)
      try {
        await saveSettings(next)
      } catch (cause) {
        setScopeError(
          "save",
          errorMessage(cause, t("Couldn't save recording settings.")),
        )
      }
    },
    [saveSettings, setScopeError],
  )

  const chooseOutputFolder = useCallback(async () => {
    if (!recording) return
    setScopeError("folder", null)
    try {
      const folder = await recording.selectOutputFolder()
      if (!folder) return
      // Newer hosts apply the picked folder themselves. Older ones only
      // return it, so save it through the settings path, which moves the
      // library and recorder onto it.
      const current = await recording.getSettings()
      if (current.outputFolder === folder) confirmSettings(current)
      else await save({ ...current, outputFolder: folder })
      setStorageInfo(await recording.getStorageInfo())
    } catch (cause) {
      setScopeError(
        "folder",
        errorMessage(cause, t("Couldn't change the capture folder.")),
      )
    }
  }, [recording, save, confirmSettings, setStorageInfo, setScopeError])

  const restartBackend = useCallback(async () => {
    if (!recording) return
    setScopeError("restart", null)
    setRestarting(true)
    try {
      const nextStatus = await recording.restartBackend()
      setStatus(nextStatus)
    } catch (cause) {
      setScopeError(
        "restart",
        errorMessage(cause, t("Couldn't restart Alloy agent.")),
      )
      throw cause
    } finally {
      setRestarting(false)
    }
  }, [recording, setStatus, setScopeError])

  const listNotificationSounds = useCallback(async () => {
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
  }, [recording, setScopeError])

  const openNotificationSoundsFolder = useCallback(
    async (sound: RecordingNotificationSoundEvent) => {
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
    [recording, setScopeError],
  )

  const previewNotificationSound = useCallback(
    async (sound: RecordingNotificationSoundEvent) => {
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
    [recording, setScopeError],
  )

  const listGameProcesses = useCallback(async () => {
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
  }, [recording, setScopeError])

  const listDisplays = useCallback(async () => {
    if (!recording) return []
    setScopeError("displays", null)
    try {
      return await recording.listDisplays()
    } catch (cause) {
      setScopeError(
        "displays",
        errorMessage(cause, t("Couldn't load displays.")),
      )
      return []
    }
  }, [recording, setScopeError])

  const busy = loading || storageLoading || restarting
  const value = useMemo<DesktopRecordingContextValue>(
    () => ({
      settings,
      status,
      storageInfo: storageInfo ?? null,
      busy,
      error,
      errors,
      save,
      restartBackend,
      chooseOutputFolder,
      listNotificationSounds,
      openNotificationSoundsFolder,
      previewNotificationSound,
      listGameProcesses,
      listDisplays,
    }),
    [
      settings,
      status,
      storageInfo,
      busy,
      error,
      errors,
      save,
      restartBackend,
      chooseOutputFolder,
      listNotificationSounds,
      openNotificationSoundsFolder,
      previewNotificationSound,
      listGameProcesses,
      listDisplays,
    ],
  )

  return (
    <DesktopRecordingContext.Provider value={value}>
      {children}
    </DesktopRecordingContext.Provider>
  )
}

export function useDesktopRecording(): DesktopRecordingContextValue {
  const value = useContext(DesktopRecordingContext)
  if (!value) {
    throw new Error(
      "useDesktopRecording must be used within a DesktopRecordingProvider",
    )
  }
  return value
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
