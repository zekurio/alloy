import { t } from "@alloy/i18n"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ReactNode } from "react"

import { errorMessage } from "@/lib/error-message"

interface SettingsFormSnapshot {
  /** The form has edits that differ from the saved values. */
  dirty: boolean
  /** A save is in flight. */
  saving: boolean
  /** Invalid forms keep the shared save action disabled. */
  valid?: boolean
}

interface SettingsFormHandlers {
  save: () => void | Promise<void>
  discard: () => void
}

interface SettingsSaveRegistry {
  update: (
    id: string,
    snapshot: SettingsFormSnapshot,
    handlers: SettingsFormHandlers,
  ) => void
  remove: (id: string) => void
}

type SettingsSaveFeedback =
  | { state: "idle" | "pending" | "success" }
  | { state: "error"; message: string }

interface SettingsSaveState {
  /** Any registered form has unsaved edits. */
  dirty: boolean
  /** Any registered form is saving. */
  saving: boolean
  /** Every dirty registered form can currently be saved. */
  valid: boolean
  /**
   * Bumped each time a close or tab switch is blocked by unsaved edits, so
   * the save banner can replay its attention flash per attempt.
   */
  attention: number
  /** Outcome of the latest save, shown by the save banner. */
  feedback: SettingsSaveFeedback
  requestAttention: () => void
  /** Saves every dirty form; never rejects, failures land in `feedback`. */
  saveAll: () => Promise<void>
  discardAll: () => void
}

// Two contexts on purpose: forms subscribe to the registry, whose identity
// never changes, so registering can't loop when the aggregated state (which
// changes on every keystroke that flips dirtiness) re-renders consumers.
const SettingsSaveRegistryContext = createContext<SettingsSaveRegistry | null>(
  null,
)
const SettingsSaveStateContext = createContext<SettingsSaveState | null>(null)

/**
 * Collects the dirty/save/discard state of every settings form so the dialog
 * can turn the section header into one save banner and block closing with
 * unsaved edits.
 * Lives outside the dialog content, so it survives open/close transitions.
 */
export function SettingsSaveProvider({ children }: { children: ReactNode }) {
  // Handlers live in a ref: their identity changes every render of the
  // registering form, and only the call-time value matters.
  const handlersRef = useRef(new Map<string, SettingsFormHandlers>())
  const [snapshots, setSnapshots] = useState<
    ReadonlyMap<string, SettingsFormSnapshot>
  >(new Map())
  const [attention, setAttention] = useState(0)
  // Feedback lives here rather than in the bar so every way of saving (the
  // bar's button, Enter in a form) reports through the same bar.
  const [feedback, setFeedback] = useState<SettingsSaveFeedback>({
    state: "idle",
  })
  const resetTimer = useRef<number | null>(null)

  const update = useCallback<SettingsSaveRegistry["update"]>(
    (id, snapshot, handlers) => {
      handlersRef.current.set(id, handlers)
      setSnapshots((prev) => {
        const current = prev.get(id)
        if (
          current &&
          current.dirty === snapshot.dirty &&
          current.saving === snapshot.saving &&
          current.valid === snapshot.valid
        ) {
          return prev
        }
        const next = new Map(prev)
        next.set(id, snapshot)
        return next
      })
    },
    [],
  )

  const remove = useCallback((id: string) => {
    handlersRef.current.delete(id)
    setSnapshots((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  const registry = useMemo<SettingsSaveRegistry>(
    () => ({ update, remove }),
    [update, remove],
  )

  let dirty = false
  let saving = false
  let valid = true
  for (const snapshot of snapshots.values()) {
    dirty ||= snapshot.dirty
    saving ||= snapshot.saving
    if (snapshot.dirty) valid &&= snapshot.valid !== false
  }

  const clearResetTimer = useCallback(() => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = null
  }, [])

  useEffect(() => clearResetTimer, [clearResetTimer])

  const saveAll = useCallback(async () => {
    if (saving || !valid || feedback.state === "pending") return
    clearResetTimer()
    setFeedback({ state: "pending" })
    try {
      const jobs: Promise<void>[] = []
      for (const [id, snapshot] of snapshots) {
        if (!snapshot.dirty || snapshot.saving) continue
        const handlers = handlersRef.current.get(id)
        if (handlers) jobs.push(Promise.resolve(handlers.save()))
      }
      await Promise.all(jobs)
      setFeedback({ state: "success" })
      resetTimer.current = window.setTimeout(() => {
        setFeedback({ state: "idle" })
        resetTimer.current = null
      }, 1400)
    } catch (cause) {
      setFeedback({
        state: "error",
        message: errorMessage(cause, t("Couldn't save changes")),
      })
    }
  }, [snapshots, saving, valid, feedback.state, clearResetTimer])

  const discardAll = useCallback(() => {
    clearResetTimer()
    setFeedback({ state: "idle" })
    for (const [id, snapshot] of snapshots) {
      if (!snapshot.dirty) continue
      handlersRef.current.get(id)?.discard()
    }
  }, [snapshots, clearResetTimer])

  const requestAttention = useCallback(() => {
    setAttention((count) => count + 1)
  }, [])

  const state = useMemo<SettingsSaveState>(
    () => ({
      dirty,
      saving,
      valid,
      attention,
      feedback,
      requestAttention,
      saveAll,
      discardAll,
    }),
    [
      dirty,
      saving,
      valid,
      attention,
      feedback,
      requestAttention,
      saveAll,
      discardAll,
    ],
  )

  return (
    <SettingsSaveRegistryContext.Provider value={registry}>
      <SettingsSaveStateContext.Provider value={state}>
        {children}
      </SettingsSaveStateContext.Provider>
    </SettingsSaveRegistryContext.Provider>
  )
}

export function useSettingsSaveState(): SettingsSaveState {
  const value = useContext(SettingsSaveStateContext)
  if (!value) {
    throw new Error(
      "useSettingsSaveState must be used within a SettingsSaveProvider",
    )
  }
  return value
}

/**
 * Registers a form with the settings save banner, which renders its Cancel/Save
 * controls. Forms keep no save footer of their own, so one rendered outside a
 * SettingsSaveProvider (the settings dialog and page) throws instead of
 * silently losing its only way to save.
 */
export function useSettingsSaveBar(
  form: SettingsFormSnapshot & SettingsFormHandlers,
): void {
  const registry = useContext(SettingsSaveRegistryContext)
  if (!registry) {
    throw new Error(
      "useSettingsSaveBar must be used within a SettingsSaveProvider",
    )
  }
  const id = useId()

  const formRef = useRef(form)
  // Stable wrappers so re-registration never captures stale closures.
  const handlers = useMemo<SettingsFormHandlers>(
    () => ({
      save: () => formRef.current.save(),
      discard: () => formRef.current.discard(),
    }),
    [],
  )

  // Re-register every render; the provider ignores no-op snapshot updates.
  useEffect(() => {
    formRef.current = form
    registry.update(
      id,
      { dirty: form.dirty, saving: form.saving, valid: form.valid },
      handlers,
    )
  })

  useEffect(() => () => registry.remove(id), [registry, id])
}
