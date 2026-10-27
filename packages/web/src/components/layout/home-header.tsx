import { t } from "@alloy/i18n"
import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
  AppHeaderSearch,
} from "@alloy/ui/components/app-header"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@alloy/ui/components/tooltip"
import { useWindowEvent } from "@alloy/ui/hooks/use-window-event"
import { Link, useRouterState } from "@tanstack/react-router"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import type { ReactNode } from "react"

import { useAppSearchStore } from "@/components/search/app-search"
import { SearchResultsPopover } from "@/components/search/search-results-popover"
import { alloyWindowChrome } from "@/lib/desktop"

import { DesktopWindowControls } from "./desktop-window-controls"
import { UserMenu } from "./user-menu"

export function HomeHeader() {
  const query = useAppSearchStore((state) => state.query)
  const { setQuery, clear, setOpen } = useAppSearchStore.getState()
  const inputRef = useRef<HTMLInputElement>(null)
  const desktop = alloyWindowChrome()

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
      <AppHeaderBrand
        showText
        className="max-md:hidden"
        renderLogo={(logo) => (
          // The logo is an inline-flex span; inside a block anchor it sits on
          // a text baseline that reserves descender space below the mark. A
          // flex anchor has no line box, so the logo centers cleanly.
          <Link
            to="/"
            aria-label={t("Home")}
            className="flex shrink-0 items-center"
          >
            {logo}
          </Link>
        )}
      >
        <HeaderNavigation />
      </AppHeaderBrand>
      <Link
        to="/"
        data-slot="app-header-brand"
        aria-label={t("Home")}
        className="flex items-center justify-self-start pl-1.5 md:hidden"
      >
        <AlloyLogo size={32} />
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
        onInteractOutside={() => setOpen(false)}
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
      <AppHeaderActions className="h-full gap-1.5">
        <UserMenu />
        {desktop ? (
          <DesktopWindowControls chrome={desktop} className="ml-1" />
        ) : null}
      </AppHeaderActions>
    </AppHeader>
  )
}

function HeaderNavigation() {
  const history = useHeaderNavigationHistory()

  return (
    <TooltipProvider delay={300}>
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
    </TooltipProvider>
  )
}

function useHeaderNavigationHistory() {
  // Drive availability from the router's real history position rather than a
  // url-matching heuristic: matching on href misreads a fresh push to a
  // previously-seen url (e.g. going back to /library) as a "back" and wrongly
  // enables forward.
  const entry = useRouterState({
    select: (state) => {
      // SAFETY: TanStack Router stores these optional navigation fields in
      // location state and preserves other state written by callers.
      const historyState = state.location.state as {
        __TSR_index?: number
        __TSR_key?: string
      }
      // An entry whose state was written outside the router (missing or NaN
      // index) counts as the bottom of the stack.
      const index = historyState.__TSR_index
      return {
        index: index !== undefined && Number.isInteger(index) ? index : 0,
        key: historyState.__TSR_key ?? state.location.href,
      }
    },
  })

  const [stack, setStack] = useState(() =>
    recordHistoryEntry(EMPTY_HISTORY, entry.index, entry.key),
  )
  const current = recordHistoryEntry(stack, entry.index, entry.key)
  if (current !== stack) setStack(current)

  return {
    canGoBack: entry.index > 0,
    canGoForward: entry.index < current.top,
    goBack: () => {
      if (entry.index > 0) window.history.back()
    },
    goForward: () => {
      if (entry.index < current.top) window.history.forward()
    },
  }
}

/** The key last seen at each history index, and the newest index. */
type HistoryStack = {
  keysByIndex: ReadonlyMap<number, string>
  top: number
}

const EMPTY_HISTORY: HistoryStack = { keysByIndex: new Map(), top: 0 }

/**
 * A back/forward restores a known key at its index. A push or replace lands a
 * new key, which discards any forward history, so that index becomes the top.
 */
function recordHistoryEntry(
  stack: HistoryStack,
  index: number,
  key: string,
): HistoryStack {
  if (stack.keysByIndex.get(index) === key) return stack
  const keysByIndex = new Map<number, string>()
  for (const [seenIndex, seenKey] of stack.keysByIndex) {
    if (seenIndex < index) keysByIndex.set(seenIndex, seenKey)
  }
  keysByIndex.set(index, key)
  return { keysByIndex, top: index }
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
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className="text-foreground-muted hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-background active:text-foreground-muted disabled:text-foreground-faint grid size-9 place-items-center rounded-md border-0 bg-transparent p-0 transition-colors outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-5"
          >
            {children}
          </button>
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
