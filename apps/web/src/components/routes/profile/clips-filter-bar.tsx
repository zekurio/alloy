import { Link, useNavigate } from "@tanstack/react-router"
import { ChevronDownIcon, XIcon } from "lucide-react"

import { Chip } from "@workspace/ui/components/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import type { ProfileAllSort } from "../../../routes/_app.u.$username.all"

/**
 * Sort + game filter bar for `/u/:username/all`. Every control mutates the
 * URL search params — there is no local state — so reloads and shares
 * preserve the exact view.
 *
 *   ?sort=recent | oldest | top | views   (default `recent` is encoded as absent)
 *   ?game=<slug>                          (absent = no game filter)
 *
 * Sort chips render as `<Link>`s (no onClick) so they get native
 * middle-click / cmd-click / focus semantics. The game picker opens a menu
 * of only the games present in the user's clip list — no extra fetch.
 */
type GameOption = {
  slug: string
  name: string
  count: number
}

type ClipsFilterBarProps = {
  username: string
  sort: ProfileAllSort
  gameSlug: string | null
  selectedGameName: string | null
  gameOptions: GameOption[]
}

const SORT_OPTIONS: ReadonlyArray<{
  key: ProfileAllSort
  label: string
}> = [
  { key: "recent", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "top", label: "Most liked" },
  { key: "views", label: "Most viewed" },
]

export function ClipsFilterBar({
  username,
  sort,
  gameSlug,
  selectedGameName,
  gameOptions,
}: ClipsFilterBarProps) {
  const navigate = useNavigate()

  // Search params omit defaults so the URL stays clean ("/all" is a valid
  // canonical form — sort=recent, game=null).
  const searchFor = (nextSort: ProfileAllSort, nextGameSlug: string | null) => {
    const out: { sort?: ProfileAllSort; game?: string } = {}
    if (nextSort !== "recent") out.sort = nextSort
    if (nextGameSlug) out.game = nextGameSlug
    return out
  }

  const clearGame = () => {
    void navigate({
      to: "/u/$username/all",
      params: { username },
      search: searchFor(sort, null),
      replace: true,
    })
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      {/* Sort group */}
      <div className="flex items-center gap-1.5">
        <span className="pr-1 font-mono text-2xs tracking-[0.1em] text-foreground-faint uppercase">
          Sort
        </span>
        {SORT_OPTIONS.map((opt) => (
          <Chip
            key={opt.key}
            render={
              <Link
                to="/u/$username/all"
                params={{ username }}
                search={searchFor(opt.key, gameSlug)}
                data-active={sort === opt.key ? "true" : undefined}
              />
            }
          >
            {opt.label}
          </Chip>
        ))}
      </div>

      {/* Vertical divider */}
      {gameOptions.length > 0 ? (
        <span aria-hidden className="h-5 w-px bg-border" />
      ) : null}

      {/* Game filter */}
      {gameOptions.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <span className="pr-1 font-mono text-2xs tracking-[0.1em] text-foreground-faint uppercase">
            Game
          </span>
          {gameSlug && selectedGameName ? (
            <Chip
              data-active="true"
              onClick={clearGame}
              aria-label={`Clear game filter: ${selectedGameName}`}
            >
              {selectedGameName}
              <XIcon />
            </Chip>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Chip>
                    All games
                    <ChevronDownIcon />
                  </Chip>
                }
              />
              <DropdownMenuContent className="max-h-64 w-56">
                {gameOptions.map((g) => (
                  <DropdownMenuItem
                    key={g.slug}
                    render={
                      <Link
                        to="/u/$username/all"
                        params={{ username }}
                        search={searchFor(sort, g.slug)}
                      />
                    }
                  >
                    <span className="truncate">{g.name}</span>
                    <span className="ml-auto font-mono text-2xs text-foreground-faint">
                      {g.count}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ) : null}
    </div>
  )
}
