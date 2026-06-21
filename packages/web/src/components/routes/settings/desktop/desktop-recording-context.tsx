import type {
  RecordingDisplay,
  RecordingEvent,
  RecordingGameProcess,
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundLibrary,
  RecordingSettings,
  RecordingStatus,
  RecordingStorageInfo,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
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

import { alloyDesktop } from "./desktop-bridge"

type Phase = "loading" | "idle"

interface DesktopRecordingContextValue {
  settings: RecordingSettings | null
  status: RecordingStatus | null
  storageInfo: RecordingStorageInfo | null
  phase: Phase
  busy: boolean
  /** Local-only update, e.g. live slider dragging before committing. */
  setSettings: Dispatch<SetStateAction<RecordingSettings | null>>
  /** Persist the given settings to the desktop shell. */
  save: (next: RecordingSettings) => Promise<void>
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
  const saveSequence = useRef(0)
  const lastStatusMessageToast = useRef<string | null>(null)

  useEffect(() => {
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
          toast.error(errorText(cause, t("Couldn't load recording settings.")))
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

  useEffect(() => {
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

  const save = useCallback(
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
        toast.error(errorText(cause, t("Couldn't save recording settings.")))
      }
    },
    [recording],
  )

  const chooseOutputFolder = useCallback(async () => {
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
      toast.error(errorText(cause, t("Couldn't change the capture folder.")))
    }
  }, [recording])

  const listNotificationSounds = useCallback(async () => {
    if (!recording) return EMPTY_SOUND_LIBRARY
    try {
      return await recording.listNotificationSounds()
    } catch (cause) {
      toast.error(errorText(cause, t("Couldn't load notification sounds.")))
      return EMPTY_SOUND_LIBRARY
    }
  }, [recording])

  const openNotificationSoundsFolder = useCallback(
    async (sound: RecordingNotificationSoundEvent) => {
      if (!recording) return
      try {
        await recording.openNotificationSoundsFolder(sound)
      } catch (cause) {
        toast.error(errorText(cause, t("Couldn't open the sounds folder.")))
      }
    },
    [recording],
  )

  const previewNotificationSound = useCallback(
    async (sound: RecordingNotificationSoundEvent) => {
      if (!recording) return
      try {
        await recording.previewNotificationSound(sound)
      } catch (cause) {
        toast.error(errorText(cause, t("Couldn't play the sound.")))
      }
    },
    [recording],
  )

  const listGameProcesses = useCallback(async () => {
    if (!recording) return []
    try {
      return await recording.listGameProcesses()
    } catch (cause) {
      toast.error(errorText(cause, t("Couldn't load running processes.")))
      return []
    }
  }, [recording])

  const listDisplays = useCallback(async () => {
    if (!recording) return []
    try {
      return await recording.listDisplays()
    } catch (cause) {
      toast.error(errorText(cause, t("Couldn't load displays.")))
      return []
    }
  }, [recording])

  const value = useMemo<DesktopRecordingContextValue>(
    () => ({
      settings,
      status,
      storageInfo,
      phase,
      busy: phase !== "idle",
      setSettings,
      save,
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
      save,
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

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
