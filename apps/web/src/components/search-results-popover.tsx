import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  FilmIcon,
  GamepadIcon,
  Loader2Icon,
  SearchIcon,
  UserIcon,
} from "lucide-react"

import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import { useAppSearch } from "./app-search"
import type { ClipRow } from "../lib/clips-api"
import type { GameListRow } from "../lib/games-api"
import { useSearchQuery, type UserListRow } from "../lib/search-api"
import {
  ClipRowItem,
  EmptyBlock,
  GameRowItem,
  GroupLabel,
  quote,
  UserRowItem,
} from "./search-results-popover-items"

type FlatItem =
  | { kind: "game"; id: string; row: GameListRow }
  | { kind: "user"; id: string; row: UserListRow }
  | { kind: "clip"; id: string; row: ClipRow }

function useSearchPopoverState(
  flat: FlatItem[],
  open: boolean,
  clear: () => void,
  setOpen: (value: boolean) => void
) {
  const navigate = useNavigate()
  const [activeIndex, setActiveIndex] = React.useState(0)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    setActiveIndex(0)
  }, [flat])

  const closePopover = React.useCallback(() => {
    setOpen(false)
  }, [setOpen])

  const commitClip = React.useCallback(
    (row: ClipRow) => {
      closePopover()
      clear()
      const slug = row.gameRef?.slug
      if (!slug) return
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, clip: row.id }),
        mask: {
          to: "/g/$slug/c/$clipId",
          params: { slug, clipId: row.id },
        },
      })
    },
    [clear, closePopover, navigate]
  )

  const commitGame = React.useCallback(
    (row: GameListRow) => {
      closePopover()
      clear()
      // Clear before navigating — avoids a 1-frame flash of "old query,
      // new page" while navigation is in flight.
      void navigate({ to: "/g/$slug", params: { slug: row.slug } })
    },
    [clear, closePopover, navigate]
  )

  const commitUser = React.useCallback(
    (row: UserListRow) => {
      closePopover()
      clear()
      void navigate({
        to: "/u/$username",
        params: { username: row.username },
      })
    },
    [clear, closePopover, navigate]
  )

  // Window-scoped so ↓/↑/Esc work even when focus is still in the input.
  // Gated on `open` so other surfaces aren't intercepted.
  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        clear()
        return
      }
      if (flat.length === 0) return
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setActiveIndex((i) => (i + 1) % flat.length)
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        setActiveIndex((i) => (i - 1 + flat.length) % flat.length)
      } else if (event.key === "Enter") {
        const item = flat[activeIndex]
        if (!item) return
        event.preventDefault()
        if (item.kind === "clip") commitClip(item.row)
        else if (item.kind === "game") commitGame(item.row)
        else commitUser(item.row)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, flat, activeIndex, clear, commitClip, commitGame, commitUser])

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      const wrapper = rootRef.current?.closest<HTMLElement>(
        '[data-slot="app-header-search"]'
      )
      if (wrapper && wrapper.contains(target)) return
      closePopover()
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open, closePopover])

  return {
    activeIndex,
    setActiveIndex,
    commitClip,
    commitGame,
    commitUser,
    rootRef,
  }
}

export function SearchResultsPopover() {
  const { query, deferredQuery, open, setOpen, clear } = useAppSearch()

  const { data, isFetching, error } = useSearchQuery(deferredQuery, {
    enabled: open && deferredQuery.length > 0,
  })

  const flat = React.useMemo<FlatItem[]>(() => {
    if (!data) return []
    // Order matches the rendering split below so `activeIndex` maps to
    // the right row.
    return [
      ...data.games.map<FlatItem>((row) => ({
        kind: "game",
        id: `game:${row.id}`,
        row,
      })),
      ...data.users.map<FlatItem>((row) => ({
        kind: "user",
        id: `user:${row.id}`,
        row,
      })),
      ...data.clips.map<FlatItem>((row) => ({
        kind: "clip",
        id: `clip:${row.id}`,
        row,
      })),
    ]
  }, [data])

  const {
    activeIndex,
    setActiveIndex,
    commitClip,
    commitGame,
    commitUser,
    rootRef,
  } = useSearchPopoverState(flat, open, clear, setOpen)

  const showPopover = open && query.trim().length > 0

  return (
    <>
      {showPopover ? (
        <div
          ref={rootRef}
          role="listbox"
          aria-label="Search results"
          className={cn(
            "absolute top-full right-0 left-0 z-50",
            "alloy-glass overflow-hidden border",
            // Desktop: flush against the input — square top, no top border.
            "sm:rounded-t-none sm:rounded-b-md sm:border-t-0",
            "max-sm:top-[calc(100%+0.5rem)] max-sm:rounded-md",
            "animate-in duration-100 fade-in-0 zoom-in-95"
          )}
          style={
            {
              "--alloy-glass-opacity": "78%",
              "--alloy-glass-shadow": "0 24px 60px -28px rgb(0 0 0 / 0.78)",
            } as React.CSSProperties
          }
          onMouseDown={(event) => event.preventDefault()}
        >
          <SearchResultsBody
            query={deferredQuery}
            isFetching={isFetching}
            error={error}
            flat={flat}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onCommitClip={commitClip}
            onCommitGame={commitGame}
            onCommitUser={commitUser}
          />
        </div>
      ) : null}
    </>
  )
}

type SearchResultsBodyProps = {
  query: string
  isFetching: boolean
  error: Error | null
  flat: FlatItem[]
  activeIndex: number
  onHover: (index: number) => void
  onCommitClip: (row: ClipRow) => void
  onCommitGame: (row: GameListRow) => void
  onCommitUser: (row: UserListRow) => void
}

function SearchResultsBody({
  query,
  isFetching,
  error,
  flat,
  activeIndex,
  onHover,
  onCommitClip,
  onCommitGame,
  onCommitUser,
}: SearchResultsBodyProps) {
  const hasResults = flat.length > 0
  if (error && !hasResults) {
    return (
      <EmptyBlock
        icon={<SearchIcon />}
        title="Couldn't search"
        hint={error.message}
      />
    )
  }
  if (!hasResults && isFetching) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-4 text-sm font-semibold text-foreground-muted">
        <Spinner className="size-3.5" />
        Searching for {quote(query)}…
      </div>
    )
  }
  if (!hasResults) {
    return (
      <EmptyBlock
        icon={<SearchIcon />}
        title="No matches"
        hint={`Nothing found for ${quote(query)}. Try a different title, game, or creator.`}
      />
    )
  }

  const games = flat.filter(
    (i): i is Extract<FlatItem, { kind: "game" }> => i.kind === "game"
  )
  const users = flat.filter(
    (i): i is Extract<FlatItem, { kind: "user" }> => i.kind === "user"
  )
  const clips = flat.filter(
    (i): i is Extract<FlatItem, { kind: "clip" }> => i.kind === "clip"
  )
  const firstUserIndex = games.length
  const firstClipIndex = games.length + users.length

  return (
    <div
      className={cn(
        "flex max-h-[70vh] flex-col overflow-y-auto pt-0.5",
        // Subtle header-row typographic style used across the app.
        "font-sans"
      )}
    >
      {games.length > 0 ? (
        <section>
          <GroupLabel icon={<GamepadIcon />}>Games</GroupLabel>
          <ul>
            {games.map((item, localIdx) => {
              const globalIdx = localIdx
              return (
                <li key={item.id}>
                  <GameRowItem
                    row={item.row}
                    active={activeIndex === globalIdx}
                    onHover={() => onHover(globalIdx)}
                    onSelect={() => onCommitGame(item.row)}
                  />
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
      {users.length > 0 ? (
        <section>
          <GroupLabel icon={<UserIcon />}>Users</GroupLabel>
          <ul>
            {users.map((item, localIdx) => {
              const globalIdx = firstUserIndex + localIdx
              return (
                <li key={item.id}>
                  <UserRowItem
                    row={item.row}
                    active={activeIndex === globalIdx}
                    onHover={() => onHover(globalIdx)}
                    onSelect={() => onCommitUser(item.row)}
                  />
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
      {clips.length > 0 ? (
        <section>
          <GroupLabel icon={<FilmIcon />}>Clips</GroupLabel>
          <ul>
            {clips.map((item, localIdx) => {
              const globalIdx = firstClipIndex + localIdx
              return (
                <li key={item.id}>
                  <ClipRowItem
                    row={item.row}
                    active={activeIndex === globalIdx}
                    onHover={() => onHover(globalIdx)}
                    onSelect={() => onCommitClip(item.row)}
                  />
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
      {isFetching ? (
        <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground-muted">
          <Loader2Icon className="size-3 animate-spin" />
          Updating…
        </div>
      ) : null}
    </div>
  )
}
