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
  const locationKey = useRouterState({
    select: (state) => state.location.href,
  })
  const stackRef = React.useRef([locationKey])
  const indexRef = React.useRef(0)
  const [availability, setAvailability] = React.useState({
    canGoBack: false,
    canGoForward: false,
  })

  React.useEffect(() => {
    const stack = stackRef.current
    const index = indexRef.current
    const previousKey = stack[index - 1]
    const nextKey = stack[index + 1]

    if (locationKey === previousKey) {
      indexRef.current = index - 1
    } else if (locationKey === nextKey) {
      indexRef.current = index + 1
    } else if (locationKey !== stack[index]) {
      stack.splice(index + 1, stack.length - index - 1, locationKey)
      indexRef.current = index + 1
    }

    setAvailability({
      canGoBack: indexRef.current > 0,
      canGoForward: indexRef.current < stackRef.current.length - 1,
    })
  }, [locationKey])

  return {
    ...availability,
    goBack: React.useCallback(() => {
      if (indexRef.current > 0) window.history.back()
    }, []),
    goForward: React.useCallback(() => {
      if (indexRef.current < stackRef.current.length - 1) {
        window.history.forward()
      }
    }, []),
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
