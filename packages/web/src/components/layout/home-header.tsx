import { useRouterState } from "@tanstack/react-router"
import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
  AppHeaderSearch,
  AppHeaderWindowControls,
} from "alloy-ui/components/app-header"
import { useWindowEvent } from "alloy-ui/hooks/use-window-event"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
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
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const hideMobileSearch = pathname === "/library" || pathname === "/library/"

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
      <AppHeaderBrand showText={desktop?.titlebarOverlay}>
        {desktop?.titlebarOverlay ? <HeaderNavigation /> : null}
        <div className="ml-1">
          <DesktopRecordingStatus />
        </div>
      </AppHeaderBrand>
      <AppHeaderSearch
        ref={inputRef}
        value={query}
        placeholder="Search..."
        aria-label="Search"
        containerClassName={hideMobileSearch ? "max-sm:hidden" : undefined}
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

function HeaderNavigation() {
  const history = useHeaderNavigationHistory()

  return (
    <div className="hidden items-center gap-1 md:flex">
      <HeaderNavigationButton
        label="Go back"
        disabled={!history.canGoBack}
        onClick={history.goBack}
      >
        <ChevronLeftIcon />
      </HeaderNavigationButton>
      <HeaderNavigationButton
        label="Go forward"
        disabled={!history.canGoForward}
        onClick={history.goForward}
      >
        <ChevronRightIcon />
      </HeaderNavigationButton>
    </div>
  )
}

function useHeaderNavigationHistory() {
  // Drive availability from the router's real history position rather than a
  // url-matching heuristic: matching on href misreads a fresh push to a
  // previously-seen url (e.g. going back to /library, or the editor's many
  // `replace` navigations) as a "back" and wrongly enables forward.
  const entry = useRouterState({
    select: (state) => {
      const historyState = state.location.state as {
        __TSR_index?: number
        __TSR_key?: string
      }
      return {
        index: historyState.__TSR_index ?? 0,
        key: historyState.__TSR_key ?? state.location.href,
      }
    },
  })

  // index -> the key last seen at that position. A push/replace lands a new
  // key (truncating everything ahead); a back/forward restores a known key.
  const keysByIndexRef = React.useRef(new Map<number, string>())
  const topIndexRef = React.useRef(entry.index)
  const [availability, setAvailability] = React.useState({
    canGoBack: false,
    canGoForward: false,
  })

  React.useEffect(() => {
    const keysByIndex = keysByIndexRef.current
    if (keysByIndex.get(entry.index) !== entry.key) {
      // New entry here (push or replace): it discards any forward history, so
      // this position becomes the top of the stack.
      keysByIndex.set(entry.index, entry.key)
      for (const seenIndex of keysByIndex.keys()) {
        if (seenIndex > entry.index) keysByIndex.delete(seenIndex)
      }
      topIndexRef.current = entry.index
    }

    setAvailability({
      canGoBack: entry.index > 0,
      canGoForward: entry.index < topIndexRef.current,
    })
  }, [entry.index, entry.key])

  return {
    ...availability,
    goBack: React.useCallback(() => {
      if (entry.index > 0) window.history.back()
    }, [entry.index]),
    goForward: React.useCallback(() => {
      if (entry.index < topIndexRef.current) window.history.forward()
    }, [entry.index]),
  }
}

function HeaderNavigationButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="text-foreground-muted hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-background active:text-foreground-muted disabled:text-foreground-faint grid size-9 place-items-center rounded-md border-0 bg-transparent p-0 transition-colors outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-5"
    >
      {children}
    </button>
  )
}
