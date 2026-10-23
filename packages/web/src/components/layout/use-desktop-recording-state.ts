import type {
  RecordingDisplay,
  RecordingEvent,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/desktop-contracts"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useCallback, useEffect, useRef, useState } from "react"

import type { AlloyDesktopRecordingApi } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"
import { useDesktopQuery } from "@/lib/use-desktop-query"

/**
 * Recording settings and status kept in sync with the desktop sidecar. Shared
 * by the sidebar capture widget and the desktop settings panels.
 *
 * `save` applies settings optimistically, then reconciles with the sidecar's
 * response. A sequence counter discards stale responses when saves overlap.
 * A rejected save rolls back and rethrows, unless a newer save superseded it.
 */
export function useRecordingSync(recording: AlloyDesktopRecordingApi | null) {
  const [settings, setSettings] = useState<RecordingSettings | null>(null)
  const [status, setStatus] = useState<RecordingStatus | null>(null)
  const [loading, setLoading] = useState(recording !== null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const saveSequence = useRef(0)
  // Last settings the host confirmed, for rolling back a rejected save.
  const confirmedSettings = useRef<RecordingSettings | null>(null)

  // Subscribe to push events first, then backfill from a one-shot fetch for
  // whichever of the two no event has arrived for yet.
  useEffect(() => {
    if (!recording) {
      setLoading(false)
      return
    }

    let cancelled = false
    let receivedSettingsEvent = false
    let receivedStatusEvent = false
    setLoading(true)
    setLoadError(null)
    const unsubscribe = recording.onEvent((event: RecordingEvent) => {
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

    void Promise.all([recording.getSettings(), recording.getStatus()])
      .then(
        ([nextSettings, nextStatus]) => {
          if (cancelled) return
          if (!receivedSettingsEvent) {
            confirmedSettings.current = nextSettings
            setSettings(nextSettings)
          }
          if (!receivedStatusEvent) setStatus(nextStatus)
        },
        (cause: unknown) => {
          if (!cancelled) setLoadError(cause)
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      unsubscribe()
      confirmedSettings.current = null
      setSettings(null)
      setStatus(null)
    }
  }, [recording])

  /** Shows settings the host has already applied, e.g. read back after a change. */
  const confirmSettings = useCallback((next: RecordingSettings) => {
    confirmedSettings.current = next
    setSettings(next)
  }, [])

  const save = useCallback(
    async (next: RecordingSettings) => {
      if (!recording) return
      const sequence = ++saveSequence.current
      setSettings(next)
      try {
        const saved = await recording.setSettings(next)
        confirmedSettings.current = saved
        if (sequence !== saveSequence.current) return
        setSettings(saved)
      } catch (cause) {
        if (sequence !== saveSequence.current) return
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
        if (sequence !== saveSequence.current) return
        setSettings(restored)
        throw cause
      }
    },
    [recording],
  )

  return {
    settings,
    status,
    setStatus,
    loading,
    loadError,
    confirmSettings,
    save,
  }
}

/**
 * Load the display list when the picker opens. Display capture also shows the
 * selected display's thumbnail, so fetch the list once for that if the picker
 * hasn't loaded it yet.
 */
function useRecordingDisplays(
  recording: AlloyDesktopRecordingApi | null,
  displayPickerOpen: boolean,
  captureMode: RecordingSettings["captureMode"] | undefined,
) {
  const picker = useDesktopQuery(
    recording && displayPickerOpen
      ? () => listDisplays(recording, t("Couldn't load displays."))
      : null,
    [recording, displayPickerOpen],
  )
  const needsPreview = captureMode === "display" && picker.data === undefined
  const preview = useDesktopQuery(
    recording && needsPreview
      ? () => listDisplays(recording, t("Couldn't load display preview."))
      : null,
    [recording, needsPreview],
  )

  return {
    displays: picker.data ?? preview.data ?? [],
    displayLoading: picker.loading,
  }
}

function listDisplays(recording: AlloyDesktopRecordingApi, failure: string) {
  return recording.listDisplays().catch((cause: unknown) => {
    toast.error(errorMessage(cause, failure))
    throw cause
  })
}

export function useDesktopRecordingState(
  recording: AlloyDesktopRecordingApi | null,
) {
  const [displayPickerOpen, setDisplayPickerOpen] = useState(false)
  const {
    settings,
    status,
    loadError,
    save: saveSettings,
  } = useRecordingSync(recording)
  const { displays, displayLoading } = useRecordingDisplays(
    recording,
    displayPickerOpen,
    settings?.captureMode,
  )

  // The widget stays in its loading state until the host sends settings, so
  // say why instead of waiting silently.
  useEffect(() => {
    if (!loadError) return
    toast.error(errorMessage(loadError, t("Couldn't load recording settings.")))
  }, [loadError])

  const save = useCallback(
    (next: RecordingSettings) =>
      saveSettings(next).catch((cause: unknown) => {
        toast.error(errorMessage(cause, t("Couldn't save recording settings.")))
      }),
    [saveSettings],
  )

  const selectDisplay = useCallback(
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
