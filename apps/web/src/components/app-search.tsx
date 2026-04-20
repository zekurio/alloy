import * as React from "react"

/**
 * Header search context.
 *
 * Used to be an in-place filter — every feed section read `normalizedQuery`
 * from this context and called `filterClipsByQuery()` / `filterGamesByQuery()`
 * over its already-fetched rows. We've since moved to a dropdown-results
 * model: the header renders a popover with mixed clip + game hits fetched
 * from `/api/search`, and feed sections no longer react to the query at
 * all. So this provider's job shrank to "hold the input's text + whether
 * the results popover is open, and expose a way to clear / close from
 * anywhere (Esc, result click, route change)".
 *
 * The deferred value is kept because it's what `useSearchQuery` keys
 * off — it gives us React's free debounce-ish behaviour without a
 * timer, so typing stays fluid even if the network is slow.
 */
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

  // Wrap `setQuery` so any text entry re-opens the popover. Without this
  // the popover would stay closed after an Esc + re-type cycle — the
  // user pressed Esc, cleared `open`, and the next keystroke has no
  // hook to reopen.
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
