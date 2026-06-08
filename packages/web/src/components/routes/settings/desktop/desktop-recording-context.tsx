import type {
  RecordingActionResult,
  RecordingEvent,
  RecordingSettings,
  RecordingStatus,
  RecordingStorageInfo,
} from "alloy-contracts"
import { toast } from "alloy-ui/lib/toast"
import * as React from "react"

import { alloyDesktop } from "./desktop-bridge"

type Phase = "loading" | "idle"
type RecordingAction = "saveReplayClip"

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

  React.useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    let statusInterval: ReturnType<typeof setInterval> | undefined

    async function load() {
      if (!recording) return
      setPhase("loading")
      try {
        unsubscribe = recording.onEvent((event: RecordingEvent) => {
          if (cancelled) return
          if ("status" in event) {
            setStatus(event.status)
          }
        })
        const [nextSettings, nextStatus, nextStorage] = await Promise.all([
          recording.getSettings(),
          recording.getStatus(),
          recording.getStorageInfo(),
        ])
        if (cancelled) return
        setSettings(nextSettings)
        setStatus(nextStatus)
        setStorageInfo(nextStorage)
        setPhase("idle")

        statusInterval = setInterval(() => {
          void recording
            .getStatus()
            .then((status) => {
              if (!cancelled) setStatus(status)
            })
            .catch((cause) => {
              if (!cancelled) {
                toast.error(
                  errorText(cause, "Couldn't refresh recording status."),
                )
              }
            })
        }, 2000)
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
      if (statusInterval) clearInterval(statusInterval)
      unsubscribe?.()
    }
  }, [recording])

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

  const runAction = React.useCallback(
    async (action: RecordingAction): Promise<RecordingActionResult> => {
      if (!recording) {
        throw new Error(
          status?.message ?? "Desktop recording is not available.",
        )
      }

      try {
        const result = await recording[action]()
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
    }),
    [settings, status, storageInfo, phase, save, runAction, chooseOutputFolder],
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
