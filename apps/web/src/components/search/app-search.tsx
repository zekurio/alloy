import * as React from "react"

type AppSearchContextValue = {
  query: string
  /** `query` passed through `useDeferredValue` + trim + lowercase. */
  deferredQuery: string
  setQuery: (next: string) => void
  clear: () => void
  open: boolean
  setOpen: (open: boolean) => void
}

const AppSearchContext = React.createContext<AppSearchContextValue | null>(null)

export function AppSearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQueryState] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const deferredQueryRaw = React.useDeferredValue(query)
  const deferredQuery = React.useMemo(
    () => deferredQueryRaw.trim(),
    [deferredQueryRaw]
  )

  const setQuery = React.useCallback((next: string) => {
    setQueryState(next)
    if (next.length > 0) setOpen(true)
  }, [])

  const clear = React.useCallback(() => {
    setQueryState("")
    setOpen(false)
  }, [])

  const value = React.useMemo(
    () => ({
      query,
      deferredQuery,
      setQuery,
      clear,
      open,
      setOpen,
    }),
    [query, deferredQuery, setQuery, clear, open]
  )

  return (
    <AppSearchContext.Provider value={value}>
      {children}
    </AppSearchContext.Provider>
  )
}

export function useAppSearch() {
  const value = React.useContext(AppSearchContext)
  if (!value) {
    throw new Error("useAppSearch must be used inside AppSearchProvider")
  }
  return value
}
