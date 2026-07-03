import type { ClipRow, GameListRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { useDocumentEvent } from "@alloy/ui/hooks/use-document-event"
import { useWindowEvent } from "@alloy/ui/hooks/use-window-event"
import { cn } from "@alloy/ui/lib/utils"
import { useNavigate } from "@tanstack/react-router"
import { FilmIcon, GamepadIcon, SearchIcon, UserIcon } from "lucide-react"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import type { CSSProperties, RefObject } from "react"

import {
  enrichLibraryItem,
  useLibraryGameLookup,
  useLibrarySnapshot,
  type LibraryItemView,
} from "@/components/routes/library/library-data"
import type { AppSearch } from "@/lib/app-search"
import { alloyDesktop } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"
import { type UserListRow, useSearchQuery } from "@/lib/search-api"

import { useAppSearch } from "./app-search"
import { searchLocalClips } from "./local-clip-search"
import { quote } from "./search-format"
import {
  ClipRowItem,
  EmptyBlock,
  GameRowItem,
  GroupLabel,
  LocalClipRowItem,
  SearchLoadingBar,
  SearchResultsSkeleton,
  UserRowItem,
} from "./search-result-items"

type FlatItem =
  | { kind: "game"; id: string; optionId: string; row: GameListRow }
  | { kind: "user"; id: string; optionId: string; row: UserListRow }
  | { kind: "local-clip"; id: string; optionId: string; row: LibraryItemView }
  | {
      kind: "clip"
      id: string
      optionId: string
      row: ClipRow
      localFallback: LibraryItemView | null
    }

type ClipItem = Extract<FlatItem, { kind: "clip" | "local-clip" }>

function resultOptionId(listboxId: string, id: string): string {
  return `${listboxId}-option-${encodeURIComponent(id)}`
}

function useSearchPopoverState(
  flat: FlatItem[],
  open: boolean,
  clear: () => void,
  setOpen: (value: boolean) => void,
) {
  const navigate = useNavigate()
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setActiveIndex(0)
  }, [flat])

  const closePopover = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  const commitClip = useCallback(
    (row: ClipRow) => {
      closePopover()
      clear()
      const gameId = row.gameRef ? row.gameRef.slug : null
      void navigate({
        to: ".",
        search: (prev: AppSearch) => ({ ...prev, clip: row.id }),
        mask: gameId
          ? {
              to: "/games/$gameId/clips/$clipId",
              params: { gameId, clipId: row.id },
            }
          : {
              to: "/clips/$clipId",
              params: { clipId: row.id },
            },
      })
    },
    [clear, closePopover, navigate],
  )

  const commitLocalClip = useCallback(
    (row: LibraryItemView) => {
      closePopover()
      clear()
      void navigate({
        to: "/library/$captureId",
        params: { captureId: row.id },
      })
    },
    [clear, closePopover, navigate],
  )

  const commitGame = useCallback(
    (row: GameListRow) => {
      closePopover()
      clear()
      // Clear before navigating — avoids a 1-frame flash of "old query,
      // new page" while navigation is in flight.
      void navigate({
        to: "/games/$gameId",
        params: { gameId: row.slug },
      })
    },
    [clear, closePopover, navigate],
  )

  const commitUser = useCallback(
    (row: UserListRow) => {
      closePopover()
      clear()
      void navigate({
        to: "/u/$username",
        params: { username: row.username },
      })
    },
    [clear, closePopover, navigate],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target
      const wrapper = rootRef.current?.closest<HTMLElement>(
        '[data-slot="app-header-search"]',
      )
      if (!(target instanceof Node) || !wrapper?.contains(target)) return
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
        else if (item.kind === "local-clip") commitLocalClip(item.row)
        else if (item.kind === "game") commitGame(item.row)
        else commitUser(item.row)
      }
    },
    [
      flat,
      activeIndex,
      clear,
      commitClip,
      commitGame,
      commitLocalClip,
      commitUser,
    ],
  )

  // Window-scoped so ↓/↑/Esc work even when focus is still in the input.
  // Gated on `open` so other surfaces aren't intercepted.
  useWindowEvent("keydown", onKeyDown, undefined, open)

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      const wrapper = rootRef.current?.closest<HTMLElement>(
        '[data-slot="app-header-search"]',
      )
      if (wrapper && wrapper.contains(target)) return
      closePopover()
    },
    [closePopover],
  )
  useDocumentEvent("pointerdown", onPointerDown, undefined, open)

  return {
    activeIndex,
    setActiveIndex,
    commitClip,
    commitLocalClip,
    commitGame,
    commitUser,
    rootRef,
  }
}

function useFlatSearchResults(
  data: ReturnType<typeof useSearchQuery>["data"],
  localClips: LibraryItemView[],
  localFallbacks: Map<string, LibraryItemView>,
  listboxId: string,
): FlatItem[] {
  return useMemo<FlatItem[]>(() => {
    const serverClipIds = new Set((data?.clips ?? []).map((row) => row.id))
    const localOnlyClips = localClips.filter((row) => {
      return !row.uploadedClipId || !serverClipIds.has(row.uploadedClipId)
    })

    return [
      ...(data?.games ?? []).map<FlatItem>((row) => ({
        kind: "game",
        id: `game:${row.id}`,
        optionId: resultOptionId(listboxId, `game:${row.id}`),
        row,
      })),
      ...(data?.users ?? []).map<FlatItem>((row) => ({
        kind: "user",
        id: `user:${row.id}`,
        optionId: resultOptionId(listboxId, `user:${row.id}`),
        row,
      })),
      ...(data?.clips ?? []).map<FlatItem>((row) => ({
        kind: "clip",
        id: `clip:${row.id}`,
        optionId: resultOptionId(listboxId, `clip:${row.id}`),
        row,
        localFallback: localFallbacks.get(row.id) ?? null,
      })),
      ...localOnlyClips.map<FlatItem>((row) => ({
        kind: "local-clip",
        id: `local-clip:${row.id}`,
        optionId: resultOptionId(listboxId, `local-clip:${row.id}`),
        row,
      })),
    ]
  }, [data, localClips, localFallbacks, listboxId])
}

function useLocalClipSearch(
  query: string,
  {
    enabled,
    limit,
  }: {
    enabled: boolean
    limit: number
  },
) {
  const desktop = enabled ? alloyDesktop() : null
  const { snapshot, refreshing } = useLibrarySnapshot(desktop, {
    toastErrors: false,
  })
  const gamesByName = useLibraryGameLookup(snapshot)
  const fallbackByClipId = useMemo(() => {
    const map = new Map<string, LibraryItemView>()
    for (const item of snapshot?.items ?? []) {
      if (!item.uploadedClipId) continue
      map.set(item.uploadedClipId, enrichLibraryItem(item, gamesByName))
    }
    return map
  }, [snapshot, gamesByName])
  const localClips = useMemo(
    () => searchLocalClips({ snapshot, gamesByName, query, limit }),
    [snapshot, gamesByName, query, limit],
  )

  return {
    clips: localClips,
    fallbackByClipId,
    pending: enabled && desktop !== null && !snapshot && refreshing,
  }
}

function useSearchInputA11y(
  bridgeRef: RefObject<HTMLSpanElement | null>,
  showPopover: boolean,
  listboxId: string,
  activeOptionId: string | undefined,
): void {
  useEffect(() => {
    const wrapper = bridgeRef.current?.closest<HTMLElement>(
      '[data-slot="app-header-search"]',
    )
    const input = wrapper?.querySelector<HTMLInputElement>("input")
    if (!input) return

    input.setAttribute("role", "combobox")
    input.setAttribute("aria-autocomplete", "list")
    input.setAttribute("aria-haspopup", "listbox")
    input.setAttribute("aria-expanded", showPopover ? "true" : "false")

    if (showPopover) input.setAttribute("aria-controls", listboxId)
    else input.removeAttribute("aria-controls")

    if (activeOptionId) {
      input.setAttribute("aria-activedescendant", activeOptionId)
    } else input.removeAttribute("aria-activedescendant")

    return () => {
      input.removeAttribute("role")
      input.removeAttribute("aria-autocomplete")
      input.removeAttribute("aria-haspopup")
      input.removeAttribute("aria-expanded")
      input.removeAttribute("aria-controls")
      input.removeAttribute("aria-activedescendant")
    }
  }, [activeOptionId, bridgeRef, listboxId, showPopover])
}

export function SearchResultsPopover() {
  const { query, deferredQuery, open, setOpen, clear } = useAppSearch()
  const bridgeRef = useRef<HTMLSpanElement | null>(null)
  const listboxId = useId()

  const trimmedQuery = query.trim()

  const { data, isFetching, error } = useSearchQuery(deferredQuery, {
    enabled: open && deferredQuery.length > 0,
  })
  const local = useLocalClipSearch(deferredQuery, {
    enabled: open && deferredQuery.length > 0,
    limit: 8,
  })

  const flat = useFlatSearchResults(
    data,
    local.clips,
    local.fallbackByClipId,
    listboxId,
  )

  const {
    activeIndex,
    setActiveIndex,
    commitClip,
    commitLocalClip,
    commitGame,
    commitUser,
    rootRef,
  } = useSearchPopoverState(flat, open, clear, setOpen)

  const showPopover = open && trimmedQuery.length > 0
  const activeOptionId =
    showPopover && flat.length > 0 ? flat[activeIndex]?.optionId : undefined

  // Pending covers both the debounce/deferral gap (the live query hasn't
  // reached `deferredQuery` yet) and an in-flight request for the settled
  // query. Treating the gap as pending stops the popover flashing "No matches"
  // before the search has even started.
  const pending = isFetching || local.pending || trimmedQuery !== deferredQuery

  useSearchInputA11y(bridgeRef, showPopover, listboxId, activeOptionId)

  return (
    <>
      <span ref={bridgeRef} hidden />
      {showPopover ? (
        <div
          id={listboxId}
          ref={rootRef}
          role="listbox"
          aria-label={t("Search results")}
          className={cn(
            "absolute top-[calc(100%+0.5rem)] right-0 left-0 z-50",
            "alloy-blur overflow-hidden rounded-md border",
            "animate-in duration-100 fade-in-0 zoom-in-95",
          )}
          style={
            {
              "--alloy-blur-opacity": "82%",
              "--alloy-blur-blur": "28px",
              "--alloy-blur-shadow": "0 24px 60px -28px rgb(0 0 0 / 0.78)",
            } as CSSProperties
          }
          onMouseDown={(event) => event.preventDefault()}
        >
          {pending ? <SearchLoadingBar /> : null}
          <SearchResultsBody
            query={deferredQuery}
            pending={pending}
            error={error}
            flat={flat}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onCommitClip={commitClip}
            onCommitLocalClip={commitLocalClip}
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
  pending: boolean
  error: Error | null
  flat: FlatItem[]
  activeIndex: number
  onHover: (index: number) => void
  onCommitClip: (row: ClipRow) => void
  onCommitLocalClip: (row: LibraryItemView) => void
  onCommitGame: (row: GameListRow) => void
  onCommitUser: (row: UserListRow) => void
}

function SearchResultsBody({
  query,
  pending,
  error,
  flat,
  activeIndex,
  onHover,
  onCommitClip,
  onCommitLocalClip,
  onCommitGame,
  onCommitUser,
}: SearchResultsBodyProps) {
  const hasResults = flat.length > 0
  // Stale-while-revalidate: as long as we have results (even from the previous
  // keystroke, kept via `keepPreviousData`) we keep showing them. The loading
  // bar at the popover's top edge is the only "fetching" signal, so typing
  // never tears the list down. Skeletons and the empty/error states are
  // reserved for when there is genuinely nothing to display.
  if (!hasResults) {
    if (pending) return <SearchResultsSkeleton />
    if (error) {
      return (
        <EmptyBlock
          icon={<SearchIcon />}
          title={t("Couldn't search")}
          hint={errorMessage(error, t("Search failed"))}
        />
      )
    }
    return (
      <EmptyBlock
        icon={<SearchIcon />}
        title={t("No matches")}
        hint={t(
          "Nothing found for {query}. Try a different title, game, file, or creator.",
          { query: quote(query) },
        )}
      />
    )
  }

  const games = flat.filter(
    (i): i is Extract<FlatItem, { kind: "game" }> => i.kind === "game",
  )
  const users = flat.filter(
    (i): i is Extract<FlatItem, { kind: "user" }> => i.kind === "user",
  )
  const clips = flat.filter((i): i is ClipItem => isClipItem(i))
  const firstUserIndex = games.length
  const firstClipIndex = games.length + users.length

  return (
    <div
      className={cn(
        "flex max-h-[70vh] flex-col overflow-y-auto pt-0.5",
        // Subtle header-row typographic style used across the app.
        "font-sans",
      )}
    >
      {games.length > 0 ? (
        <section>
          <GroupLabel icon={<GamepadIcon />}>{t("Games")}</GroupLabel>
          <ul>
            {games.map((item, localIdx) => {
              const globalIdx = localIdx
              return (
                <li key={item.id}>
                  <GameRowItem
                    id={item.optionId}
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
          <GroupLabel icon={<UserIcon />}>{t("Users")}</GroupLabel>
          <ul>
            {users.map((item, localIdx) => {
              const globalIdx = firstUserIndex + localIdx
              return (
                <li key={item.id}>
                  <UserRowItem
                    id={item.optionId}
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
          <GroupLabel icon={<FilmIcon />}>{t("Clips")}</GroupLabel>
          <ul>
            {clips.map((item, localIdx) => {
              const globalIdx = firstClipIndex + localIdx
              return (
                <li key={item.id}>
                  {item.kind === "clip" ? (
                    <ClipRowItem
                      id={item.optionId}
                      row={item.row}
                      localFallback={item.localFallback}
                      active={activeIndex === globalIdx}
                      onHover={() => onHover(globalIdx)}
                      onSelect={() => onCommitClip(item.row)}
                    />
                  ) : (
                    <LocalClipRowItem
                      id={item.optionId}
                      row={item.row}
                      active={activeIndex === globalIdx}
                      onHover={() => onHover(globalIdx)}
                      onSelect={() => onCommitLocalClip(item.row)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function isClipItem(item: FlatItem): item is ClipItem {
  return item.kind === "clip" || item.kind === "local-clip"
}
