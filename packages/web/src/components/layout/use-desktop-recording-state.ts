import type {
  RecordingDisplay,
  RecordingEvent,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/contracts/desktop"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useCallback, useEffect, useState } from "react"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

import type { AlloyDesktopRecordingApi } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"
import { useDesktopQuery } from "@/lib/use-desktop-query"

type RecordingSyncState = {
  settings: RecordingSettings | null
  status: RecordingStatus | null
  loading: boolean
  loadError: unknown
}

const DISCONNECTED: RecordingSyncState = {
  settings: null,
  status: null,
  loading: true,
  loadError: null,
}

/**
 * Recording settings and status kept in sync with the desktop sidecar. Shared
 * by the sidebar capture widget and the desktop settings panels, which hold
 * one bridge subscription between them while any of them is mounted.
 */
const useRecordingSyncStore = create<RecordingSyncState>()(() => DISCONNECTED)

type RecordingSyncSession = {
  readers: number
  loadErrorListeners: Set<(cause: unknown) => void>
  backfill: () => void
  stop: () => void
}

let session: RecordingSyncSession | null = null
let saveSequence = 0
// Last settings the host confirmed, for rolling back a rejected save.
let confirmedSettings: RecordingSettings | null = null

/**
 * Subscribe to push events first, then backfill from a one-shot fetch for
 * whichever of the two no event has arrived for yet.
 */
function startRecordingSync(
  recording: AlloyDesktopRecordingApi,
): RecordingSyncSession {
  let stopped = false
  let receivedSettingsEvent = false
  let receivedStatusEvent = false
  const loadErrorListeners = new Set<(cause: unknown) => void>()

  const unsubscribe = recording.onEvent((event: RecordingEvent) => {
    if (stopped) return
    if (event.type === "settings") {
      receivedSettingsEvent = true
      confirmedSettings = event.settings
      useRecordingSyncStore.setState({ settings: event.settings })
    }
    if ("status" in event) {
      receivedStatusEvent = true
      useRecordingSyncStore.setState({ status: event.status })
    }
  })

  const backfill = () => {
    useRecordingSyncStore.setState({ loading: true, loadError: null })
    void Promise.all([recording.getSettings(), recording.getStatus()]).then(
      ([nextSettings, nextStatus]) => {
        if (stopped) return
        if (!receivedSettingsEvent) confirmedSettings = nextSettings
        const current = useRecordingSyncStore.getState()
        useRecordingSyncStore.setState({
          settings: receivedSettingsEvent ? current.settings : nextSettings,
          status: receivedStatusEvent ? current.status : nextStatus,
          loading: false,
        })
      },
      (cause: unknown) => {
        if (stopped) return
        useRecordingSyncStore.setState({ loading: false, loadError: cause })
        for (const listener of loadErrorListeners) listener(cause)
      },
    )
  }

  return {
    readers: 0,
    loadErrorListeners,
    backfill,
    stop: () => {
      stopped = true
      unsubscribe()
      // Drop the results of saves still in flight.
      saveSequence += 1
      confirmedSettings = null
      useRecordingSyncStore.setState(DISCONNECTED)
    },
  }
}

/**
 * Holds the shared subscription until the returned release runs. A reader
 * that arrives after a failed load retries it. `onLoadError` hears every
 * failed load while this reader holds the subscription.
 */
function retainRecordingSync(
  recording: AlloyDesktopRecordingApi,
  onLoadError: ((cause: unknown) => void) | undefined,
): () => void {
  const starting = session === null
  const current = session ?? startRecordingSync(recording)
  session = current
  current.readers += 1
  // A fresh closure per reader, so two readers passing the same callback
  // each keep their own entry.
  const listener = onLoadError
    ? (cause: unknown) => onLoadError(cause)
    : undefined
  if (listener) current.loadErrorListeners.add(listener)

  const { loading, loadError } = useRecordingSyncStore.getState()
  if (starting || (loadError !== null && !loading)) current.backfill()

  return () => {
    if (listener) current.loadErrorListeners.delete(listener)
    current.readers -= 1
    if (current.readers > 0) return
    current.stop()
    if (session === current) session = null
  }
}

/** Keeps the shared recording state in sync with the sidecar while mounted. */
export function useRetainRecordingSync(
  recording: AlloyDesktopRecordingApi | null,
  onLoadError?: (cause: unknown) => void,
) {
  useEffect(() => {
    if (!recording) return
    return retainRecordingSync(recording, onLoadError)
  }, [recording, onLoadError])
}

/** The shared recording state; pair with `useRetainRecordingSync`. */
export function useRecordingSyncState(
  recording: AlloyDesktopRecordingApi | null,
): RecordingSyncState {
  const state = useRecordingSyncStore(useShallow((current) => current))
  return recording ? state : { ...state, loading: false }
}

/** Shows settings the host has already applied, e.g. read back after a change. */
export function confirmRecordingSettings(next: RecordingSettings) {
  confirmedSettings = next
  useRecordingSyncStore.setState({ settings: next })
}

export function setRecordingStatus(status: RecordingStatus) {
  useRecordingSyncStore.setState({ status })
}

/**
 * Applies settings optimistically, then reconciles with the sidecar's
 * response. A sequence counter discards stale responses when saves overlap.
 * A rejected save rolls back and rethrows, unless a newer save superseded it.
 */
export async function saveRecordingSettings(
  recording: AlloyDesktopRecordingApi,
  next: RecordingSettings,
) {
  const sequence = ++saveSequence
  useRecordingSyncStore.setState({ settings: next })
  try {
    const saved = await recording.setSettings(next)
    confirmedSettings = saved
    if (sequence !== saveSequence) return
    useRecordingSyncStore.setState({ settings: saved })
  } catch (cause) {
    if (sequence !== saveSequence) return
    // Roll back so the rejected value neither stays on screen nor gets
    // written back by the next change, which spreads `settings`. Prefer
    // what the host holds now; fall back to the last confirmed value.
    let restored = confirmedSettings
    try {
      restored = await recording.getSettings()
      confirmedSettings = restored
    } catch {
      // Keep the last confirmed settings.
    }
    if (sequence !== saveSequence) return
    useRecordingSyncStore.setState({ settings: restored })
    throw cause
  }
}

/**
 * Load the display list each time the picker opens. Display capture also
 * shows the selected display's thumbnail, so fetch the list once for that if
 * the picker hasn't loaded it yet.
 */
function useRecordingDisplays(
  recording: AlloyDesktopRecordingApi | null,
  displayPickerOpen: boolean,
  captureMode: RecordingSettings["captureMode"] | undefined,
) {
  const picker = useDesktopQuery(
    ["recording", "displays", "picker"],
    recording && displayPickerOpen
      ? () => listDisplays(recording, t("Couldn't load displays."))
      : null,
    { reloadWhenEnabled: () => true },
  )
  const needsPreview = captureMode === "display" && picker.data === undefined
  const preview = useDesktopQuery(
    ["recording", "displays", "preview"],
    recording && needsPreview
      ? () => listDisplays(recording, t("Couldn't load display preview."))
      : null,
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

// The widget stays in its loading state until the host sends settings, so
// say why instead of waiting silently.
function toastLoadError(cause: unknown) {
  toast.error(errorMessage(cause, t("Couldn't load recording settings.")))
}

export function useDesktopRecordingState(
  recording: AlloyDesktopRecordingApi | null,
) {
  const [displayPickerOpen, setDisplayPickerOpen] = useState(false)
  useRetainRecordingSync(recording, toastLoadError)
  const { settings, status } = useRecordingSyncState(recording)
  const { displays, displayLoading } = useRecordingDisplays(
    recording,
    displayPickerOpen,
    settings?.captureMode,
  )

  const save = useCallback(
    async (next: RecordingSettings) => {
      if (!recording) return
      await saveRecordingSettings(recording, next).catch((cause: unknown) => {
        toast.error(errorMessage(cause, t("Couldn't save recording settings.")))
      })
    },
    [recording],
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
