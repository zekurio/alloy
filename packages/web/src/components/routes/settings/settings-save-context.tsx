import { t } from "@alloy/i18n"
import { createContext, useContext, useEffect, useId, useState } from "react"
import type { ReactNode } from "react"
import { useStore } from "zustand"
import { createStore, type StoreApi } from "zustand/vanilla"

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

/** The TanStack form a settings card registers; only its actions are used. */
interface SettingsSaveForm {
  handleSubmit: () => Promise<void>
  reset: () => void
}

type SettingsSaveFeedback =
  | { state: "idle" | "pending" | "success" }
  | { state: "error"; message: string }

interface SettingsSaveState {
  forms: ReadonlyMap<string, SettingsFormSnapshot>
  /**
   * Bumped each time a close or tab switch is blocked by unsaved edits, so
   * the save banner can replay its attention flash per attempt.
   */
  attention: number
  /**
   * Outcome of the latest save, shown by the save banner. It lives here
   * rather than in the bar so every way of saving (the bar's button, Enter in
   * a form) reports through the same bar.
   */
  feedback: SettingsSaveFeedback
  register: (
    id: string,
    snapshot: SettingsFormSnapshot,
    handlers: SettingsFormHandlers,
  ) => void
  unregister: (id: string) => void
  requestAttention: () => void
  /** Saves every dirty form; never rejects, failures land in `feedback`. */
  saveAll: () => Promise<void>
  discardAll: () => void
  /** Cancels the pending feedback reset when the provider unmounts. */
  dispose: () => void
}

type SettingsSaveStore = StoreApi<SettingsSaveState>

function sameSnapshot(
  a: SettingsFormSnapshot | undefined,
  b: SettingsFormSnapshot,
): boolean {
  return (
    a !== undefined &&
    a.dirty === b.dirty &&
    a.saving === b.saving &&
    a.valid === b.valid
  )
}

function createSettingsSaveStore(): SettingsSaveStore {
  // Handlers stay out of the reactive state: only their call-time value
  // matters, and swapping them must not re-render the banner.
  const handlers = new Map<string, SettingsFormHandlers>()
  let resetTimer: number | null = null
  const clearResetTimer = () => {
    if (resetTimer !== null) window.clearTimeout(resetTimer)
    resetTimer = null
  }

  return createStore<SettingsSaveState>()((set, get) => ({
    forms: new Map(),
    attention: 0,
    feedback: { state: "idle" },
    register: (id, snapshot, next) => {
      handlers.set(id, next)
      const { forms } = get()
      if (sameSnapshot(forms.get(id), snapshot)) return
      set({ forms: new Map(forms).set(id, snapshot) })
    },
    unregister: (id) => {
      handlers.delete(id)
      const { forms } = get()
      if (!forms.has(id)) return
      const next = new Map(forms)
      next.delete(id)
      set({ forms: next })
    },
    requestAttention: () =>
      set(({ attention }) => ({ attention: attention + 1 })),
    saveAll: async () => {
      const state = get()
      if (
        selectSettingsSaving(state) ||
        !selectSettingsValid(state) ||
        state.feedback.state === "pending"
      ) {
        return
      }
      clearResetTimer()
      set({ feedback: { state: "pending" } })
      try {
        const jobs: Promise<void>[] = []
        for (const [id, snapshot] of state.forms) {
          if (!snapshot.dirty || snapshot.saving) continue
          const form = handlers.get(id)
          if (form) jobs.push(Promise.resolve(form.save()))
        }
        await Promise.all(jobs)
        set({ feedback: { state: "success" } })
        resetTimer = window.setTimeout(() => {
          set({ feedback: { state: "idle" } })
          resetTimer = null
        }, 1400)
      } catch (cause) {
        set({
          feedback: {
            state: "error",
            message: errorMessage(cause, t("Couldn't save changes")),
          },
        })
      }
    },
    discardAll: () => {
      clearResetTimer()
      set({ feedback: { state: "idle" } })
      for (const [id, snapshot] of get().forms) {
        if (!snapshot.dirty) continue
        handlers.get(id)?.discard()
      }
    },
    dispose: clearResetTimer,
  }))
}

/** Any registered form has unsaved edits. */
export function selectSettingsDirty(state: SettingsSaveState): boolean {
  for (const snapshot of state.forms.values()) {
    if (snapshot.dirty) return true
  }
  return false
}

/** Any registered form is saving. */
export function selectSettingsSaving(state: SettingsSaveState): boolean {
  for (const snapshot of state.forms.values()) {
    if (snapshot.saving) return true
  }
  return false
}

/** Every dirty registered form can currently be saved. */
export function selectSettingsValid(state: SettingsSaveState): boolean {
  for (const snapshot of state.forms.values()) {
    if (snapshot.dirty && snapshot.valid === false) return false
  }
  return true
}

const SettingsSaveStoreContext = createContext<SettingsSaveStore | null>(null)

/**
 * Collects the dirty/save/discard state of every settings form so the dialog
 * can turn the section header into one save banner and block closing with
 * unsaved edits.
 * Lives outside the dialog content, so it survives open/close transitions.
 * Scoped per provider: the settings dialog and page can be mounted together.
 */
export function SettingsSaveProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createSettingsSaveStore)
  useEffect(() => store.getState().dispose, [store])

  return (
    <SettingsSaveStoreContext.Provider value={store}>
      {children}
    </SettingsSaveStoreContext.Provider>
  )
}

function useSettingsSaveStore(hook: string): SettingsSaveStore {
  const store = useContext(SettingsSaveStoreContext)
  if (!store) {
    throw new Error(`${hook} must be used within a SettingsSaveProvider`)
  }
  return store
}

/** Reads one slice of the settings save state; re-renders only when it changes. */
export function useSettingsSave<T>(
  selector: (state: SettingsSaveState) => T,
): T {
  return useStore(useSettingsSaveStore("useSettingsSave"), selector)
}

/**
 * Registers a form with the settings save banner, which renders its Cancel/Save
 * controls. Forms keep no save footer of their own, so one rendered outside a
 * SettingsSaveProvider (the settings dialog and page) throws instead of
 * silently losing its only way to save. Saving submits the form and Cancel
 * resets it, so a failed submit must reject for the banner to report it.
 */
export function useSettingsSaveBar(
  form: SettingsSaveForm,
  { dirty, saving, valid }: SettingsFormSnapshot,
): void {
  const store = useSettingsSaveStore("useSettingsSaveBar")
  const id = useId()

  useEffect(() => {
    store.getState().register(
      id,
      { dirty, saving, valid },
      {
        save: () => form.handleSubmit(),
        discard: () => form.reset(),
      },
    )
  }, [store, id, form, dirty, saving, valid])

  useEffect(() => () => store.getState().unregister(id), [store, id])
}
