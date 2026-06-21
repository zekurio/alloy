import {
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useMemo,
  useState,
} from "react"
import type { ReactNode } from "react"

import { useDebouncedValue } from "@/lib/use-debounced-value"

type AppSearchContextValue = {
  query: string
  /** `query` debounced, deferred, and trimmed for network-backed search. */
  deferredQuery: string
  setQuery: (next: string) => void
  clear: () => void
  open: boolean
  setOpen: (open: boolean) => void
}

const AppSearchContext = createContext<AppSearchContextValue | null>(null)

export function AppSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQueryState] = useState("")
  const [open, setOpen] = useState(false)
  const debouncedQuery = useDebouncedValue(query, 180)
  const deferredQueryRaw = useDeferredValue(debouncedQuery)
  const deferredQuery = useMemo(
    () => deferredQueryRaw.trim(),
    [deferredQueryRaw],
  )

  const setQuery = useCallback((next: string) => {
    setQueryState(next)
    if (next.length > 0) setOpen(true)
  }, [])

  const clear = useCallback(() => {
    setQueryState("")
    setOpen(false)
  }, [])

  const value = useMemo(
    () => ({
      query,
      deferredQuery,
      setQuery,
      clear,
      open,
      setOpen,
    }),
    [query, deferredQuery, setQuery, clear, open],
  )

  return (
    <AppSearchContext.Provider value={value}>
      {children}
    </AppSearchContext.Provider>
  )
}

export function useAppSearch() {
  const value = useContext(AppSearchContext)
  if (!value) {
    throw new Error("useAppSearch must be used inside AppSearchProvider")
  }
  return value
}
