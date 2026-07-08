import { t } from "@alloy/i18n"
import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
  AppHeaderSearch,
  AppHeaderWindowControls,
} from "@alloy/ui/components/app-header"
import { useWindowEvent } from "@alloy/ui/hooks/use-window-event"
import { Link, useRouterState } from "@tanstack/react-router"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import { NotificationBell } from "@/components/notifications/notification-bell"
import { useAppSearch } from "@/components/search/app-search"
import { SearchResultsPopover } from "@/components/search/search-results-popover"
import { GlobalUploadControl } from "@/components/upload/global-upload-control"
import { UploadStatusPill } from "@/components/upload/upload-status-pill"
import { alloyDesktop } from "@/lib/desktop"
import { useSuspenseSession } from "@/lib/session-suspense"

export function HomeHeader() {
  const { query, setQuery, clear, setOpen } = useAppSearch()
  const inputRef = useRef<HTMLInputElement>(null)
  const desktop = alloyDesktop()
  const session = useSuspenseSession()

  const onKeyDown = useCallback((event: KeyboardEvent) => {
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
      <AppHeaderBrand showText className="max-md:hidden">
        <HeaderNavigation />
      </AppHeaderBrand>
      <Link
        to="/"
        data-slot="app-header-brand"
        aria-label={t("Home")}
        className="flex items-center justify-self-start pl-1.5 md:hidden"
      >
        <AlloyLogo size={26} />
      </Link>
      <AppHeaderSearch
        ref={inputRef}
        value={query}
        placeholder={t("Search...")}
        aria-label={t("Search")}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          if (query.trim().length > 0) setOpen(true)
        }}
        onChange={(event) => {
          setQuery(event.target.value)
        }}
        onClear={() => {
          const hadInputFocus = document.activeElement === inputRef.current
          clear()
          // Keep focus so the user can keep typing without reaching
          // for the mouse after hitting the clear button.
          if (hadInputFocus) inputRef.current?.focus()
        }}
      >
        <SearchResultsPopover />
      </AppHeaderSearch>
      <AppHeaderActions>
        {session ? <GlobalUploadControl /> : null}
        <UploadStatusPill />
        {session ? <NotificationBell /> : null}
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
        label={t("Go back")}
        disabled={!history.canGoBack}
        onClick={history.goBack}
      >
        <ChevronLeftIcon />
      </HeaderNavigationButton>
      <HeaderNavigationButton
        label={t("Go forward")}
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
  // previously-seen url (e.g. going back to /library) as a "back" and wrongly
  // enables forward.
  const entry = useRouterState({
    select: (state) => {
      const historyState = state.location.state as {
        __TSR_index?: number
        __TSR_key?: string
      }
      // An entry whose state was written outside the router (missing or NaN
      // index) counts as the bottom of the stack.
      const index = historyState.__TSR_index
      return {
        index: typeof index === "number" && Number.isInteger(index) ? index : 0,
        key: historyState.__TSR_key ?? state.location.href,
      }
    },
  })

  // index -> the key last seen at that position. A push/replace lands a new
  // key (truncating everything ahead); a back/forward restores a known key.
  const keysByIndexRef = useRef(new Map<number, string>())
  const topIndexRef = useRef(entry.index)
  const [availability, setAvailability] = useState({
    canGoBack: false,
    canGoForward: false,
  })

  useEffect(() => {
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
    goBack: useCallback(() => {
      if (entry.index > 0) window.history.back()
    }, [entry.index]),
    goForward: useCallback(() => {
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
  children: ReactNode
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
