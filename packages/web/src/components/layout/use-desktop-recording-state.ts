import type {
  RecordingDisplay,
  RecordingEvent,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/contracts"
import { toast } from "@alloy/ui/lib/toast"
import * as React from "react"

import type { AlloyDesktopRecordingApi } from "@/lib/desktop"

import { errorText } from "./recording-status-helpers"

/**
 * Keep recording settings/status in sync with the desktop sidecar: subscribe
 * to push events first, then backfill from a one-shot fetch for whichever of
 * the two no event has arrived for yet.
 */
function useRecordingSnapshot(recording: AlloyDesktopRecordingApi | null) {
  const [settings, setSettings] = React.useState<RecordingSettings | null>(null)
  const [status, setStatus] = React.useState<RecordingStatus | null>(null)

  React.useEffect(() => {
    if (!recording) return

    let cancelled = false
    let receivedSettingsEvent = false
    let receivedStatusEvent = false
    const unsubscribe = recording.onEvent((event: RecordingEvent) => {
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

    void Promise.all([recording.getSettings(), recording.getStatus()]).then(
      ([nextSettings, nextStatus]) => {
        if (cancelled) return
        if (!receivedSettingsEvent) setSettings(nextSettings)
        if (!receivedStatusEvent) setStatus(nextStatus)
      },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [recording])

  return { settings, setSettings, status }
}

/**
 * Load the display list when the picker opens, and lazily fetch thumbnails
 * when desktop capture is active but no preview has been loaded yet.
 */
function useRecordingDisplays(
  recording: AlloyDesktopRecordingApi | null,
  displayPickerOpen: boolean,
  captureMode: RecordingSettings["captureMode"] | undefined,
) {
  const [displays, setDisplays] = React.useState<RecordingDisplay[]>([])
  const [displayLoading, setDisplayLoading] = React.useState(false)

  React.useEffect(() => {
    if (!recording || !displayPickerOpen) return
    let cancelled = false
    setDisplayLoading(true)
    void recording
      .listDisplays()
      .then((nextDisplays) => {
        if (!cancelled) setDisplays(nextDisplays)
      })
      .catch((cause) =>
        toast.error(errorText(cause, "Couldn't load displays.")),
      )
      .finally(() => {
        if (!cancelled) setDisplayLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [displayPickerOpen, recording])

  React.useEffect(() => {
    if (!recording || captureMode !== "display") return
    if (displays.some((display) => display.thumbnailDataUrl)) return

    let cancelled = false
    void recording
      .listDisplays()
      .then((nextDisplays) => {
        if (!cancelled) setDisplays(nextDisplays)
      })
      .catch((cause) =>
        toast.error(errorText(cause, "Couldn't load display preview.")),
      )
    return () => {
      cancelled = true
    }
  }, [captureMode, displays, recording])

  return { displays, displayLoading }
}

/**
 * Optimistically apply settings, then reconcile with (or roll back to) the
 * sidecar's response. A sequence counter discards stale responses when saves
 * overlap.
 */
function useSaveRecordingSettings(
  recording: AlloyDesktopRecordingApi | null,
  settings: RecordingSettings | null,
  setSettings: React.Dispatch<React.SetStateAction<RecordingSettings | null>>,
) {
  const saveSequence = React.useRef(0)

  return React.useCallback(
    async (next: RecordingSettings) => {
      if (!recording) return
      const previous = settings
      const sequence = ++saveSequence.current
      setSettings(next)
      try {
        const saved = await recording.setSettings(next)
        if (sequence !== saveSequence.current) return
        setSettings(saved)
      } catch (cause) {
        if (sequence !== saveSequence.current) return
        setSettings(previous)
        toast.error(errorText(cause, "Couldn't save recording settings."))
      }
    },
    [recording, setSettings, settings],
  )
}

export function useDesktopRecordingState(
  recording: AlloyDesktopRecordingApi | null,
) {
  const [displayPickerOpen, setDisplayPickerOpen] = React.useState(false)
  const { settings, setSettings, status } = useRecordingSnapshot(recording)
  const { displays, displayLoading } = useRecordingDisplays(
    recording,
    displayPickerOpen,
    settings?.captureMode,
  )
  const save = useSaveRecordingSettings(recording, settings, setSettings)

  const selectDisplay = React.useCallback(
    (display: RecordingDisplay) => {
      if (!settings) return
      void save({
        ...settings,
        enabled: true,
        captureMode: "display",
        selectedDisplayId: display.id,
      })
      setDisplayPickerOpen(false)
    },
    [save, settings],
  )

  return {
    displayLoading,
    displayPickerOpen,
    displays,
    save,
    selectDisplay,
    setDisplayPickerOpen,
    settings,
    status,
  }
}
