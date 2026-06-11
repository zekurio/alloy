import type {
  RecordingActionResult,
  RecordingActionRequest,
  RecordingDisplay,
  RecordingEvent,
  RecordingGameProcess,
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundLibrary,
  SaveReplayClipRequest,
  RecordingSettings,
  RecordingStatus,
  RecordingStorageInfo,
} from "@alloy/contracts"
import { toast } from "@alloy/ui/lib/toast"
import * as React from "react"

import { alloyDesktop } from "./desktop-bridge"

type Phase = "loading" | "idle"
type RecordingAction =
  | { type: "saveReplayClip"; request: SaveReplayClipRequest }
  | { type: "addBookmark"; request: RecordingActionRequest }
  | { type: "takeScreenshot"; request: RecordingActionRequest }
  | { type: "toggleLongRecording"; request: RecordingActionRequest }

interface DesktopRecordingContextValue {
  settings: RecordingSettings | null
  status: RecordingStatus | null
  storageInfo: RecordingStorageInfo | null
  phase: Phase
  busy: boolean
  /** Local-only update, e.g. live slider dragging before committing. */
  setSettings: React.Dispatch<React.SetStateAction<RecordingSettings | null>>
  /** Persist the given settings to the desktop shell. */
  save: (next: RecordingSettings) => Promise<void>
  runAction: (action: RecordingAction) => Promise<RecordingActionResult>
  /** Open the native folder picker and apply the chosen capture folder. */
  chooseOutputFolder: () => Promise<void>
  /** List the audio files available in each event's notification sounds folder. */
  listNotificationSounds: () => Promise<RecordingNotificationSoundLibrary>
  /** Open an event's notification sounds folder so the user can add files. */
  openNotificationSoundsFolder: (
    sound: RecordingNotificationSoundEvent,
  ) => Promise<void>
  /** Return running processes that can be added to the game allow list. */
  listGameProcesses: () => Promise<RecordingGameProcess[]>
  /** Return displays that can be selected for desktop capture. */
  listDisplays: () => Promise<RecordingDisplay[]>
}

const EMPTY_SOUND_LIBRARY: RecordingNotificationSoundLibrary = {
  recordingStarted: [],
  manualRecordingStarted: [],
  clipSaved: [],
  screenshotTaken: [],
  bookmarkAdded: [],
}

const DesktopRecordingContext =
  React.createContext<DesktopRecordingContextValue | null>(null)

/**
 * Loads and owns the desktop recording settings + capture status. Mounted once
 * around the desktop settings panels so switching between Capture and Clips
 * keeps the loaded state (and any in-flight save) instead of refetching.
 */
export function DesktopRecordingProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const recording = alloyDesktop()?.recording ?? null
  const [settings, setSettings] = React.useState<RecordingSettings | null>(null)
  const [status, setStatus] = React.useState<RecordingStatus | null>(null)
  const [storageInfo, setStorageInfo] =
    React.useState<RecordingStorageInfo | null>(null)
  const [phase, setPhase] = React.useState<Phase>("loading")
  const saveSequence = React.useRef(0)
  const lastStatusMessageToast = React.useRef<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    let receivedSettingsEvent = false
    let receivedStatusEvent = false

    async function load() {
      if (!recording) return
      setPhase("loading")
      try {
        unsubscribe = recording.onEvent((event: RecordingEvent) => {
          if (cancelled) return
          if (event.type === "settings") {
            receivedSettingsEvent = true
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
        if (!receivedSettingsEvent) setSettings(nextSettings)
        if (!receivedStatusEvent) setStatus(nextStatus)
        setStorageInfo(nextStorage)
        setPhase("idle")
      } catch (cause) {
        if (!cancelled) {
          toast.error(errorText(cause, "Couldn't load recording settings."))
          setPhase("idle")
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [recording])

  React.useEffect(() => {
    const message = status?.message?.trim()
    const backend = status?.backend
    if (!message || !backend) {
      lastStatusMessageToast.current = null
      return
    }

    const toastKey = `${backend}:${message}`
    if (lastStatusMessageToast.current === toastKey) return
    lastStatusMessageToast.current = toastKey

    const options = { id: `desktop-recording-status:${toastKey}` }
    if (backend === "missing") {
      toast.warning(message, options)
    } else {
      toast.error(message, options)
    }
  }, [status?.backend, status?.message])

  const save = React.useCallback(
    async (next: RecordingSettings) => {
      if (!recording) return
      const sequence = ++saveSequence.current
      setSettings(next)
      try {
        const saved = await recording.setSettings(next)
        if (sequence !== saveSequence.current) return
        setSettings(saved)
      } catch (cause) {
        if (sequence !== saveSequence.current) return
        toast.error(errorText(cause, "Couldn't save recording settings."))
      }
    },
    [recording],
  )

  const chooseOutputFolder = React.useCallback(async () => {
    if (!recording) return
    try {
      const folder = await recording.selectOutputFolder()
      if (!folder) return
      const [nextSettings, nextStorage] = await Promise.all([
        recording.getSettings(),
        recording.getStorageInfo(),
      ])
      setSettings(nextSettings)
      setStorageInfo(nextStorage)
    } catch (cause) {
      toast.error(errorText(cause, "Couldn't change the capture folder."))
    }
  }, [recording])

  const listNotificationSounds = React.useCallback(async () => {
    if (!recording) return EMPTY_SOUND_LIBRARY
    try {
      return await recording.listNotificationSounds()
    } catch (cause) {
      toast.error(errorText(cause, "Couldn't load notification sounds."))
      return EMPTY_SOUND_LIBRARY
    }
  }, [recording])

  const openNotificationSoundsFolder = React.useCallback(
    async (sound: RecordingNotificationSoundEvent) => {
      if (!recording) return
      try {
        await recording.openNotificationSoundsFolder(sound)
      } catch (cause) {
        toast.error(errorText(cause, "Couldn't open the sounds folder."))
      }
    },
    [recording],
  )

  const listGameProcesses = React.useCallback(async () => {
    if (!recording) return []
    try {
      return await recording.listGameProcesses()
    } catch (cause) {
      toast.error(errorText(cause, "Couldn't load running processes."))
      return []
    }
  }, [recording])

  const listDisplays = React.useCallback(async () => {
    if (!recording) return []
    try {
      return await recording.listDisplays()
    } catch (cause) {
      toast.error(errorText(cause, "Couldn't load displays."))
      return []
    }
  }, [recording])

  const runAction = React.useCallback(
    async (action: RecordingAction): Promise<RecordingActionResult> => {
      if (!recording) {
        throw new Error(
          status?.message ?? "Desktop recording is not available.",
        )
      }

      try {
        const result = await runRecordingAction(recording, action)
        setStatus(result.status)
        if (!result.ok) toast.error(result.error ?? "Recording action failed.")
        return result
      } catch (cause) {
        const message = errorText(cause, "Couldn't run recording action.")
        toast.error(message)
        if (status) return { ok: false, error: message, status }
        throw new Error(message)
      }
    },
    [recording, status],
  )

  const value = React.useMemo<DesktopRecordingContextValue>(
    () => ({
      settings,
      status,
      storageInfo,
      phase,
      busy: phase !== "idle",
      setSettings,
      save,
      runAction,
      chooseOutputFolder,
      listNotificationSounds,
      openNotificationSoundsFolder,
      listGameProcesses,
      listDisplays,
    }),
    [
      settings,
      status,
      storageInfo,
      phase,
      save,
      runAction,
      chooseOutputFolder,
      listNotificationSounds,
      openNotificationSoundsFolder,
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
  const value = React.useContext(DesktopRecordingContext)
  if (!value) {
    throw new Error(
      "useDesktopRecording must be used within a DesktopRecordingProvider",
    )
  }
  return value
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

async function runRecordingAction(
  recording: NonNullable<ReturnType<typeof alloyDesktop>>["recording"],
  action: RecordingAction,
): Promise<RecordingActionResult> {
  switch (action.type) {
    case "saveReplayClip":
      return recording.saveReplayClip(action.request)
    case "addBookmark":
      return recording.addBookmark(action.request)
    case "takeScreenshot":
      return recording.takeScreenshot(action.request)
    case "toggleLongRecording":
      return recording.toggleLongRecording(action.request)
  }
}
