import * as React from "react"
import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
  AppHeaderSearch,
} from "@workspace/ui/components/app-header"

import { useAppSearch } from "./app-search"
import { NotificationCenter } from "./notification-center"
import { SearchResultsPopover } from "./search-results-popover"
import { UserMenu } from "./user-menu"

export function HomeHeader() {
  const { query, setQuery, clear, setOpen } = useAppSearch()
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "k"
      ) {
        return
      }
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <AppHeader>
      <AppHeaderBrand />
      <AppHeaderSearch
        ref={inputRef}
        value={query}
        placeholder="Search..."
        aria-label="Search"
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          if (query.trim().length > 0) setOpen(true)
        }}
        onChange={(event) => {
          setQuery(event.target.value)
        }}
        onClear={() => {
          clear()
          // Keep focus so the user can keep typing without reaching
          // for the mouse after hitting the clear button.
          inputRef.current?.focus()
        }}
      >
        <SearchResultsPopover />
      </AppHeaderSearch>
      <AppHeaderActions className="gap-2 sm:gap-3">
        <NotificationCenter />
        <UserMenu />
      </AppHeaderActions>
    </AppHeader>
  )
}
