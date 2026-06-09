import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
  AppHeaderSearch,
  AppHeaderWindowControls,
} from "alloy-ui/components/app-header"
import { useWindowEvent } from "alloy-ui/hooks/use-window-event"
import * as React from "react"

import { NotificationCenter } from "@/components/app/notification-center"
import { useAppSearch } from "@/components/search/app-search"
import { SearchResultsPopover } from "@/components/search/search-results-popover"
import { alloyDesktop } from "@/lib/desktop"

import { DesktopRecordingStatus } from "./desktop-recording-status"
import { UserMenu } from "./user-menu"

export function HomeHeader() {
  const { query, setQuery, clear, setOpen } = useAppSearch()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const desktop = alloyDesktop()

  const onKeyDown = React.useCallback((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
      return
    }
    event.preventDefault()
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  useWindowEvent("keydown", onKeyDown)

  return (
    <AppHeader>
      <AppHeaderBrand showText={desktop?.titlebarOverlay} />
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
        <DesktopRecordingStatus />
        <div className="hidden sm:block">
          <NotificationCenter />
        </div>
        <UserMenu />
      </AppHeaderActions>
      {desktop?.titlebarOverlay ? (
        <AppHeaderWindowControls
          onMinimize={() => {
            void desktop.minimizeWindow()
          }}
          onToggleMaximize={() => {
            void desktop.toggleMaximizeWindow()
          }}
          onClose={() => {
            void desktop.closeWindow()
          }}
        />
      ) : null}
    </AppHeader>
  )
}
