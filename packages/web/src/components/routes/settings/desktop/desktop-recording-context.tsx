import type {
  RecordingDisplay,
  RecordingEvent,
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
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { Dispatch, ReactNode, SetStateAction } from "react"

import { alloyDesktop } from "./desktop-native"

type Phase = "loading" | "idle"

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
  phase: Phase
  busy: boolean
  /** Failure to load settings at all; panels can't render without them. */
  error: string | null
  /** Latest failure of each operation, cleared when it next runs. */
  errors: Partial<Record<RecordingErrorScope, string>>
  /** Local-only update, e.g. live slider dragging before committing. */
  setSettings: Dispatch<SetStateAction<RecordingSettings | null>>
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

const EMPTY_SOUND_LIBRARY: RecordingNotificationSoundLibrary = {
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
  const [settings, setSettings] = useState<RecordingSettings | null>(null)
  const [status, setStatus] = useState<RecordingStatus | null>(null)
  const [storageInfo, setStorageInfo] = useState<RecordingStorageInfo | null>(
    null,
  )
  const [phase, setPhase] = useState<Phase>("loading")
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<
    Partial<Record<RecordingErrorScope, string>>
  >({})
  const saveSequence = useRef(0)
  // Last settings the host confirmed, for rolling back a rejected save.
  const confirmedSettings = useRef<RecordingSettings | null>(null)

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

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    let receivedSettingsEvent = false
    let receivedStatusEvent = false

    async function load() {
      if (!recording) {
        setSettings(null)
        setStatus(null)
        setStorageInfo(null)
        setPhase("idle")
        return
      }
      setPhase("loading")
      setError(null)
      try {
        unsubscribe = recording.onEvent((event: RecordingEvent) => {
          if (cancelled) return
          if (event.type === "settings") {
            receivedSettingsEvent = true
            confirmedSettings.current = event.settings
            setSettings(event.settings)
          }
          if ("status" in event) {
            receivedStatusEvent = true
            setStatus(event.status)
          }
        })
        const [nextSettings, nextStatus, nextStorage] = await Promise.all([
          recording.getSettings(),
          recording.getStatus(),
          recording.getStorageInfo(),
        ])
        if (cancelled) return
        if (!receivedSettingsEvent) {
          confirmedSettings.current = nextSettings
          setSettings(nextSettings)
        }
        if (!receivedStatusEvent) setStatus(nextStatus)
        setStorageInfo(nextStorage)
        setPhase("idle")
      } catch (cause) {
        if (!cancelled) {
          setError(errorText(cause, t("Couldn't load recording settings.")))
          setPhase("idle")
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      unsubscribe?.()
      confirmedSettings.current = null
      setSettings(null)
      setStatus(null)
      setStorageInfo(null)
    }
  }, [recording])

  const save = useCallback(
    async (next: RecordingSettings) => {
      if (!recording) return
      setScopeError("save", null)
      const sequence = ++saveSequence.current
      setSettings(next)
      try {
        const saved = await recording.setSettings(next)
        confirmedSettings.current = saved
        if (sequence !== saveSequence.current) return
        setSettings(saved)
      } catch (cause) {
        if (sequence !== saveSequence.current) return
        setScopeError(
          "save",
          errorText(cause, t("Couldn't save recording settings.")),
        )
        // Roll back so the rejected value neither stays on screen nor gets
        // written back by the next change, which spreads `settings`. Prefer
        // what the host holds now; fall back to the last confirmed value.
        let restored = confirmedSettings.current
        try {
          restored = await recording.getSettings()
          confirmedSettings.current = restored
        } catch {
          // Keep the last confirmed settings.
        }
        if (sequence === saveSequence.current) setSettings(restored)
      }
    },
    [recording, setScopeError],
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
      if (current.outputFolder === folder) {
        confirmedSettings.current = current
        setSettings(current)
      } else await save({ ...current, outputFolder: folder })
      setStorageInfo(await recording.getStorageInfo())
    } catch (cause) {
      setScopeError(
        "folder",
        errorText(cause, t("Couldn't change the capture folder.")),
      )
    }
  }, [recording, save, setScopeError])

  const restartBackend = useCallback(async () => {
    if (!recording) return
    setScopeError("restart", null)
    setPhase("loading")
    try {
      const nextStatus = await recording.restartBackend()
      setStatus(nextStatus)
    } catch (cause) {
      setScopeError(
        "restart",
        errorText(cause, t("Couldn't restart Alloy agent.")),
      )
      throw cause
    } finally {
      setPhase("idle")
    }
  }, [recording, setScopeError])

  const listNotificationSounds = useCallback(async () => {
    if (!recording) return EMPTY_SOUND_LIBRARY
    setScopeError("sounds", null)
    try {
      return await recording.listNotificationSounds()
    } catch (cause) {
      setScopeError(
        "sounds",
        errorText(cause, t("Couldn't load notification sounds.")),
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
          errorText(cause, t("Couldn't open the sounds folder.")),
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
        setScopeError("sounds", errorText(cause, t("Couldn't play the sound.")))
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
        errorText(cause, t("Couldn't load running processes.")),
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
      setScopeError("displays", errorText(cause, t("Couldn't load displays.")))
      return []
    }
  }, [recording, setScopeError])

  const value = useMemo<DesktopRecordingContextValue>(
    () => ({
      settings,
      status,
      storageInfo,
      phase,
      busy: phase !== "idle",
      error,
      errors,
      setSettings,
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
      phase,
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

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
