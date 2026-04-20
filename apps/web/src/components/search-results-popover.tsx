import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  FilmIcon,
  GamepadIcon,
  Loader2Icon,
  SearchIcon,
  UserIcon,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Dialog } from "@workspace/ui/components/dialog"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import { useAppSearch } from "./app-search"
import { ClipPlayerDialogContent } from "./clip-player-dialog-content"
import {
  clipThumbnailUrl,
  type ClipGameRef,
  type ClipRow,
} from "../lib/clips-api"
import {
  clipGameLabel,
  formatCount,
  formatRelativeTime,
  hueForGame,
} from "../lib/clip-format"
import type { GameListRow } from "../lib/games-api"
import { useSearchQuery, type UserListRow } from "../lib/search-api"

/**
 * Header search results popover. Reads the query string + open state from
 * `AppSearchProvider`, fetches `/api/search` for it, and renders a grouped
 * list of games, users, and clips under the header input.
 *
 * Section order is intentional: games and users are the most specific
 * aggregations (one row per entity), clips are the long tail. A query
 * like "valorant" finds the game at the top, then creators with that
 * handle, then clips — otherwise the Clips section would flood with
 * every matching highlight before the actual game row gets a look-in.
 *
 * Interaction model:
 *   - Typing opens the popover (the provider's `setQuery` flips `open`
 *     on any keystroke into the non-empty state).
 *   - ↓/↑ cycles through rows (wraps), Enter commits the highlighted row,
 *     Esc closes without committing.
 *   - Clicking a clip opens the same player dialog the feed uses; a game
 *     navigates to `/g/:slug`; a user navigates to `/u/:username`. All
 *     close the popover.
 *
 * Rendering is a sibling-of-the-input overlay — `AppHeaderSearch` gives
 * us a `relative` wrapper to anchor into. Intentionally in-flow rather
 * than portalled so it inherits the input's stacking context and the
 * `group-focus-within` state lights up naturally.
 */

// Flattened item list used for keyboard nav. Unions every section so
// ↓/↑ moves through the visible order (games → users → clips) without
// three separate index counters.
type FlatItem =
  | { kind: "game"; id: string; row: GameListRow }
  | { kind: "user"; id: string; row: UserListRow }
  | { kind: "clip"; id: string; row: ClipRow }

type ActiveClipState = {
  clip: ClipRow
  /**
   * Kept separately from `clip` so the dialog can close (clip=null) but
   * the overlay stays mounted while Base UI animates the popup out —
   * otherwise the lazy-loaded content tree would unmount mid-animation.
   */
  open: boolean
}

export function SearchResultsPopover() {
  const { query, deferredQuery, open, setOpen, clear } = useAppSearch()
  const navigate = useNavigate()

  const { data, isFetching, error } = useSearchQuery(deferredQuery, {
    enabled: open && deferredQuery.length > 0,
  })

  const flat = React.useMemo<FlatItem[]>(() => {
    if (!data) return []
    // Order matches the visual section order below. Keep in sync with
    // the rendering split so `activeIndex` maps onto the right row.
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

  // Active index resets when the flat list changes — otherwise a prior
  // selection could point past the end of the new results.
  const [activeIndex, setActiveIndex] = React.useState(0)
  React.useEffect(() => {
    setActiveIndex(0)
  }, [flat])

  const [activeClip, setActiveClip] = React.useState<ActiveClipState | null>(
    null
  )

  // Close on route change. The provider's `open` is set from outside
  // (keystrokes, Esc), so we also flip it on successful navigation so the
  // popover doesn't linger over the new page.
  const closePopover = React.useCallback(() => {
    setOpen(false)
  }, [setOpen])

  const commitClip = React.useCallback(
    (row: ClipRow) => {
      setActiveClip({ clip: row, open: true })
      closePopover()
    },
    [closePopover]
  )

  const commitGame = React.useCallback(
    (row: GameListRow) => {
      closePopover()
      clear()
      // Don't await — the navigation is fire-and-forget, and clearing
      // the input first avoids a 1-frame flash of "old query, new page".
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

  // Keyboard driver lives at window scope so it works even when focus
  // is still in the input. We gate on `open` so other surfaces' ↓/↑/Esc
  // aren't intercepted.
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

  // Mouse-outside dismiss. Listens at document level but skips events
  // whose target is inside the search wrapper — the input + popover
  // both live under `data-slot="app-header-search"` so a single closest()
  // check covers both without a ref chain.
  const rootRef = React.useRef<HTMLDivElement | null>(null)
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

  const showPopover = open && query.trim().length > 0

  return (
    <>
      {showPopover ? (
        <div
          ref={rootRef}
          role="listbox"
          aria-label="Search results"
          className={cn(
            "absolute top-full right-0 left-0 z-50 mt-1.5",
            "overflow-hidden rounded-lg border border-border bg-popover",
            "shadow-lg ring-1 ring-foreground/10",
            "animate-in duration-100 fade-in-0 zoom-in-95"
          )}
          // Keep focus on the input when the user clicks a result — the
          // row handlers do their own commit, we just prevent the
          // wrapper's mousedown from stealing focus first.
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

      {activeClip ? (
        <Dialog
          open={activeClip.open}
          onOpenChange={(nextOpen) => {
            if (nextOpen) return
            setActiveClip((prev) => (prev ? { ...prev, open: false } : prev))
            // Unmount after the close animation finishes so the lazy-
            // loaded content tree sticks around for the fade-out.
            window.setTimeout(() => setActiveClip(null), 180)
          }}
        >
          <React.Suspense fallback={null}>
            <ClipPlayerDialogContent
              clipId={activeClip.clip.id}
              thumbnail={
                activeClip.clip.thumbKey
                  ? clipThumbnailUrl(activeClip.clip.id, "full")
                  : undefined
              }
              variants={activeClip.clip.variants}
              authorHandle={activeClip.clip.authorUsername}
              authorId={activeClip.clip.authorId}
              author={activeClip.clip.authorUsername}
              authorImage={activeClip.clip.authorImage}
              title={activeClip.clip.title}
              game={clipGameLabel(activeClip.clip)}
              gameRef={activeClip.clip.gameRef}
              views={formatCount(activeClip.clip.viewCount)}
              likes={formatCount(activeClip.clip.likeCount)}
              comments={formatCount(activeClip.clip.commentCount)}
              postedAt={formatRelativeTime(activeClip.clip.createdAt)}
              accentHue={hueForGame(clipGameLabel(activeClip.clip))}
              clipPrivacy={activeClip.clip.privacy}
              description={activeClip.clip.description}
            />
          </React.Suspense>
        </Dialog>
      ) : null}
    </>
  )
}

// ─── Body ──────────────────────────────────────────────────────────────

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
  // Three display states: fetching with no cached data, fetched-and-empty,
  // or results. We keep stale results visible while re-fetching (common
  // while typing) so the list doesn't flicker to "no results" between
  // keystrokes — paired with `keepPreviousData` in `useSearchQuery`.
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
      <div className="flex items-center gap-2.5 px-3 py-4 text-sm text-foreground-faint">
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

  // Split back out of the flat list — the keyboard driver needs one
  // index space, but the UI wants sectioned groups. Running indices
  // keep `activeIndex` aligned with the rendered order.
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
        "flex max-h-[70vh] flex-col overflow-y-auto py-1.5",
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
        <div className="flex items-center gap-2 px-3 py-2 text-2xs text-foreground-faint">
          <Loader2Icon className="size-3 animate-spin" />
          Updating…
        </div>
      ) : null}
    </div>
  )
}

// ─── Rows ──────────────────────────────────────────────────────────────

function GroupLabel({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-3 pt-2 pb-1",
        "font-mono text-2xs tracking-[0.12em] text-foreground-faint uppercase",
        "[&_svg]:size-3"
      )}
    >
      {icon}
      {children}
    </div>
  )
}

type ClipRowItemProps = {
  row: ClipRow
  active: boolean
  onHover: () => void
  onSelect: () => void
}

function ClipRowItem({ row, active, onHover, onSelect }: ClipRowItemProps) {
  const thumb = row.thumbKey ? clipThumbnailUrl(row.id, "small") : null
  const label = clipGameLabel(row)
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onFocus={onHover}
      // `onMouseDown` prevents the input from losing focus — the
      // wrapper-level preventDefault covers outside clicks, but the row
      // itself also needs it so clicking doesn't blur the input mid-
      // commit.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-3 px-3 py-2 text-left",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        active ? "bg-accent-soft" : "bg-transparent",
        "hover:bg-accent-soft focus-visible:bg-accent-soft",
        "focus-visible:outline-none"
      )}
    >
      <div className="relative aspect-video w-16 shrink-0 overflow-hidden rounded-sm bg-surface-sunken">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <ThumbPlaceholder gameRef={row.gameRef} label={label} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm font-medium",
            active ? "text-accent" : "text-foreground"
          )}
        >
          {row.title}
        </div>
        <div className="truncate text-2xs text-foreground-faint">
          <span className="text-foreground-dim">{label}</span>
          <span className="mx-1.5 text-foreground-faint/60">·</span>
          <span>@{row.authorUsername}</span>
          <span className="mx-1.5 text-foreground-faint/60">·</span>
          <span>{formatCount(row.viewCount)} views</span>
        </div>
      </div>
    </button>
  )
}

type GameRowItemProps = {
  row: GameListRow
  active: boolean
  onHover: () => void
  onSelect: () => void
}

function GameRowItem({ row, active, onHover, onSelect }: GameRowItemProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onFocus={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-3 px-3 py-2 text-left",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        active ? "bg-accent-soft" : "bg-transparent",
        "hover:bg-accent-soft focus-visible:bg-accent-soft",
        "focus-visible:outline-none"
      )}
    >
      <div className="relative aspect-video w-16 shrink-0 overflow-hidden rounded-sm bg-surface-sunken">
        {row.heroUrl ? (
          <img
            src={row.heroUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <GameThumbPlaceholder name={row.name} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm font-medium",
            active ? "text-accent" : "text-foreground"
          )}
        >
          {row.name}
        </div>
        <div className="truncate text-2xs text-foreground-faint">
          {row.clipCount} {row.clipCount === 1 ? "clip" : "clips"}
        </div>
      </div>
    </button>
  )
}

type UserRowItemProps = {
  row: UserListRow
  active: boolean
  onHover: () => void
  onSelect: () => void
}

function UserRowItem({ row, active, onHover, onSelect }: UserRowItemProps) {
  // Initials fallback mirrors the rest of the app — first two chars of
  // the username, uppercased. Handles single-char usernames fine: slice
  // is a no-op past the end.
  const initials = row.username.slice(0, 2).toUpperCase()
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onFocus={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-3 px-3 py-2 text-left",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        active ? "bg-accent-soft" : "bg-transparent",
        "hover:bg-accent-soft focus-visible:bg-accent-soft",
        "focus-visible:outline-none"
      )}
    >
      {/* Width matches the clip/game thumb box so all three row types
          line up vertically — 64px container with a centred 36px
          avatar. Without this, user rows would jut in by ~28px. */}
      <div className="flex w-16 shrink-0 justify-center">
        <Avatar size="lg">
          {row.image ? <AvatarImage src={row.image} alt="" /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm font-medium",
            active ? "text-accent" : "text-foreground"
          )}
        >
          @{row.username}
        </div>
        <div className="truncate text-2xs text-foreground-faint">
          {row.clipCount} {row.clipCount === 1 ? "clip" : "clips"}
        </div>
      </div>
    </button>
  )
}

function ThumbPlaceholder({
  gameRef,
  label,
}: {
  gameRef: ClipGameRef | null
  label: string
}) {
  if (gameRef?.heroUrl) {
    return (
      <img
        src={gameRef.heroUrl}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover opacity-80"
      />
    )
  }
  const hue = hueForGame(label)
  return (
    <div
      className="h-full w-full"
      style={{
        background: `linear-gradient(140deg, oklch(0.3 0.12 ${hue}), oklch(0.15 0.06 ${hue}))`,
      }}
    />
  )
}

function GameThumbPlaceholder({ name }: { name: string }) {
  const hue = hueForGame(name)
  return (
    <div
      className="h-full w-full"
      style={{
        background: `linear-gradient(140deg, oklch(0.32 0.14 ${hue}), oklch(0.16 0.06 ${hue}))`,
      }}
    />
  )
}

function EmptyBlock({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint: string
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-4">
      <span className="mt-0.5 text-foreground-faint [&_svg]:size-4">
        {icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-2xs text-foreground-faint">{hint}</span>
      </div>
    </div>
  )
}

function quote(s: string): string {
  return `"${s}"`
}
