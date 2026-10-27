import { createContext, useCallback, useContext, useState } from "react"
import type { ReactNode } from "react"
import { useStore } from "zustand"
import { createStore, type StoreApi } from "zustand/vanilla"

export interface SettingsSection {
  id: string
  label: string
  element: HTMLElement
}

interface SettingsSectionsState {
  /** Registered subsections of the open panel, in document order. */
  sections: SettingsSection[]
  /** Adds a subsection; returns its unregister function. */
  register: (section: SettingsSection) => () => void
}

type SettingsSectionsStore = StoreApi<SettingsSectionsState>

function createSettingsSectionsStore(): SettingsSectionsStore {
  return createStore<SettingsSectionsState>()((set) => ({
    sections: [],
    register: (section) => {
      // Lazy panels mount their subsections in render order, but a re-sort on
      // every registration keeps the list correct however they arrive.
      set(({ sections }) => ({
        sections: sortByDocumentOrder([
          ...sections.filter((entry) => entry.id !== section.id),
          section,
        ]),
      }))
      return () =>
        set(({ sections }) => ({
          sections: sections.filter(
            (entry) => entry.element !== section.element,
          ),
        }))
    },
  }))
}

// Stands in outside a provider, where nothing registers, so reads stay empty.
const EMPTY_SECTIONS_STORE = createSettingsSectionsStore()

const SettingsSectionsStoreContext =
  createContext<SettingsSectionsStore | null>(null)

/**
 * Collects the subsections the open panel renders so the sidebar can list them
 * as child entries. Panels register themselves on mount instead of the category
 * table declaring their sections, which would drift the moment a panel changes.
 */
export function SettingsSectionsProvider({
  children,
}: {
  children: ReactNode
}) {
  const [store] = useState(createSettingsSectionsStore)
  return (
    <SettingsSectionsStoreContext.Provider value={store}>
      {children}
    </SettingsSectionsStoreContext.Provider>
  )
}

/** Subsections of the open panel, empty outside a provider. */
export function useSettingsSections(): SettingsSection[] {
  const store = useContext(SettingsSectionsStoreContext)
  return useStore(store ?? EMPTY_SECTIONS_STORE, (state) => state.sections)
}

/** Registers a subsection; returns the ref callback to attach to its element. */
export function useRegisterSettingsSection(id: string, label: string | null) {
  const store = useContext(SettingsSectionsStoreContext)
  return useCallback(
    (element: HTMLElement | null) => {
      if (!store || !label || !element) return
      return store.getState().register({ id, label, element })
    },
    [id, label, store],
  )
}

function sortByDocumentOrder(sections: SettingsSection[]): SettingsSection[] {
  return [...sections].sort((a, b) =>
    a.element.compareDocumentPosition(b.element) &
    Node.DOCUMENT_POSITION_FOLLOWING
      ? -1
      : 1,
  )
}
