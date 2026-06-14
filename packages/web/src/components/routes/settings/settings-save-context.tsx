import * as React from "react"

interface SettingsFormSnapshot {
  /** The form has edits that differ from the saved values. */
  dirty: boolean
  /** A save is in flight. */
  saving: boolean
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

interface SettingsSaveState {
  /** Any registered form has unsaved edits. */
  dirty: boolean
  /** Any registered form is saving. */
  saving: boolean
  /**
   * Bumped each time a close or tab switch is blocked by unsaved edits, so
   * the save bar can replay its attention animation per attempt.
   */
  attention: number
  requestAttention: () => void
  saveAll: () => Promise<void>
  discardAll: () => void
}

// Two contexts on purpose: forms subscribe to the registry, whose identity
// never changes, so registering can't loop when the aggregated state (which
// changes on every keystroke that flips dirtiness) re-renders consumers.
const SettingsSaveRegistryContext =
  React.createContext<SettingsSaveRegistry | null>(null)
const SettingsSaveStateContext = React.createContext<SettingsSaveState | null>(
  null,
)

/**
 * Collects the dirty/save/discard state of every settings form so the dialog
 * can drive one bottom-anchored save bar and block closing with unsaved edits.
 * Lives outside the dialog content, so it survives open/close transitions.
 */
export function SettingsSaveProvider({
  children,
}: {
  children: React.ReactNode
}) {
  // Handlers live in a ref: their identity changes every render of the
  // registering form, and only the call-time value matters.
  const handlersRef = React.useRef(new Map<string, SettingsFormHandlers>())
  const [snapshots, setSnapshots] = React.useState<
    ReadonlyMap<string, SettingsFormSnapshot>
  >(new Map())
  const [attention, setAttention] = React.useState(0)

  const update = React.useCallback<SettingsSaveRegistry["update"]>(
    (id, snapshot, handlers) => {
      handlersRef.current.set(id, handlers)
      setSnapshots((prev) => {
        const current = prev.get(id)
        if (
          current &&
          current.dirty === snapshot.dirty &&
          current.saving === snapshot.saving
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

  const remove = React.useCallback((id: string) => {
    handlersRef.current.delete(id)
    setSnapshots((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  const registry = React.useMemo<SettingsSaveRegistry>(
    () => ({ update, remove }),
    [update, remove],
  )

  const saveAll = React.useCallback(async () => {
    const jobs: Promise<void>[] = []
    for (const [id, snapshot] of snapshots) {
      if (!snapshot.dirty || snapshot.saving) continue
      const handlers = handlersRef.current.get(id)
      if (handlers) jobs.push(Promise.resolve(handlers.save()))
    }
    await Promise.all(jobs)
  }, [snapshots])

  const discardAll = React.useCallback(() => {
    for (const [id, snapshot] of snapshots) {
      if (!snapshot.dirty) continue
      handlersRef.current.get(id)?.discard()
    }
  }, [snapshots])

  const requestAttention = React.useCallback(() => {
    setAttention((count) => count + 1)
  }, [])

  let dirty = false
  let saving = false
  for (const snapshot of snapshots.values()) {
    dirty ||= snapshot.dirty
    saving ||= snapshot.saving
  }

  const state = React.useMemo<SettingsSaveState>(
    () => ({
      dirty,
      saving,
      attention,
      requestAttention,
      saveAll,
      discardAll,
    }),
    [dirty, saving, attention, requestAttention, saveAll, discardAll],
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
  const value = React.useContext(SettingsSaveStateContext)
  if (!value) {
    throw new Error(
      "useSettingsSaveState must be used within a SettingsSaveProvider",
    )
  }
  return value
}

/**
 * Registers a form with the settings save bar. Returns whether a bar exists:
 * `true` means the bar renders the Cancel/Save controls and the form should
 * hide its own footer; `false` (used standalone, e.g. the setup wizard) means
 * the form keeps its local buttons.
 */
export function useSettingsSaveBar(
  form: SettingsFormSnapshot & SettingsFormHandlers,
): boolean {
  const registry = React.useContext(SettingsSaveRegistryContext)
  const id = React.useId()

  const formRef = React.useRef(form)
  // Stable wrappers so re-registration never captures stale closures.
  const handlers = React.useMemo<SettingsFormHandlers>(
    () => ({
      save: () => formRef.current.save(),
      discard: () => formRef.current.discard(),
    }),
    [],
  )

  // Re-register every render; the provider ignores no-op snapshot updates.
  React.useEffect(() => {
    formRef.current = form
    registry?.update(id, { dirty: form.dirty, saving: form.saving }, handlers)
  })

  React.useEffect(() => {
    if (!registry) return
    return () => registry.remove(id)
  }, [registry, id])

  return registry !== null
}
