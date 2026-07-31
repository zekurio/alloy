import { createContext, useCallback, useContext, useState } from "react"
import type { ReactNode } from "react"

export interface SettingsSection {
  id: string
  label: string
  element: HTMLElement
}

/** Registered subsections of the open panel, in document order. */
const SettingsSectionsContext = createContext<SettingsSection[]>([])

// Registration lives in its own context so subsections, which only need the
// stable register function, don't re-render every time a sibling registers.
const RegisterSettingsSectionContext = createContext<
  ((section: SettingsSection) => () => void) | null
>(null)

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
  const [sections, setSections] = useState<SettingsSection[]>([])

  const register = useCallback((section: SettingsSection) => {
    // Lazy panels mount their subsections in render order, but a re-sort on
    // every registration keeps the list correct however they arrive.
    setSections((previous) =>
      sortByDocumentOrder([
        ...previous.filter((entry) => entry.id !== section.id),
        section,
      ]),
    )
    return () =>
      setSections((previous) =>
        previous.filter((entry) => entry.element !== section.element),
      )
  }, [])

  return (
    <RegisterSettingsSectionContext.Provider value={register}>
      <SettingsSectionsContext.Provider value={sections}>
        {children}
      </SettingsSectionsContext.Provider>
    </RegisterSettingsSectionContext.Provider>
  )
}

/** Subsections of the open panel, empty outside a provider. */
export function useSettingsSections(): SettingsSection[] {
  return useContext(SettingsSectionsContext)
}

/** Registers a subsection; returns the ref callback to attach to its element. */
export function useRegisterSettingsSection(id: string, label: string | null) {
  const register = useContext(RegisterSettingsSectionContext)
  return useCallback(
    (element: HTMLElement | null) => {
      if (!register || !label || !element) return
      return register({ id, label, element })
    },
    [id, label, register],
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
