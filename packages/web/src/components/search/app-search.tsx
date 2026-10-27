import { useDeferredValue, useEffect } from "react"
import type { ReactNode } from "react"
import { create } from "zustand"

const SEARCH_DEBOUNCE_MS = 180

type AppSearchState = {
  query: string
  /** `query` once it has held still for {@link SEARCH_DEBOUNCE_MS}. */
  debouncedQuery: string
  open: boolean
  setQuery: (next: string) => void
  clear: () => void
  setOpen: (open: boolean) => void
  reset: () => void
}

/** The header search box, shared by the header, its results and the library. */
export const useAppSearchStore = create<AppSearchState>()((set) => {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  const updateQuery = (query: string, open?: boolean) => {
    set(open === undefined ? { query } : { query, open })
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(
      () => set({ debouncedQuery: query }),
      SEARCH_DEBOUNCE_MS,
    )
  }

  return {
    query: "",
    debouncedQuery: "",
    open: false,
    setQuery: (next) => updateQuery(next, next.length > 0 ? true : undefined),
    clear: () => updateQuery("", false),
    setOpen: (open) => set({ open }),
    reset: () => {
      clearTimeout(debounceTimer)
      set({ query: "", debouncedQuery: "", open: false })
    },
  }
})

/** The search query debounced, deferred, and trimmed for network search. */
export function useDeferredSearchQuery(): string {
  const debouncedQuery = useAppSearchStore((state) => state.debouncedQuery)
  return useDeferredValue(debouncedQuery).trim()
}

/**
 * Scopes the search to an app shell: a shell that mounts again, e.g. after
 * signing out, starts with an empty search box.
 */
export function AppSearchProvider({ children }: { children: ReactNode }) {
  useEffect(() => () => useAppSearchStore.getState().reset(), [])
  return children
}
