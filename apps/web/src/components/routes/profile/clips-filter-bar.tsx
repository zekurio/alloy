import { Link, useNavigate } from "@tanstack/react-router"
import { ChevronDownIcon, XIcon } from "lucide-react"

import { Chip } from "@workspace/ui/components/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { GameIcon } from "@workspace/ui/components/game-icon"

import type { ProfileAllSort } from "../../../routes/(app)/_app.u.$username.all"

type GameOption = {
  slug: string
  name: string
  count: number
  iconUrl: string | null
  logoUrl: string | null
}

type ClipsFilterBarProps = {
  username: string
  sort: ProfileAllSort
  gameSlug: string | null
  selectedGame: GameOption | null
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
  selectedGame,
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
        <span className="pr-1 text-xs font-semibold tracking-wide text-foreground-muted uppercase">
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
          <span className="pr-1 text-xs font-semibold tracking-wide text-foreground-muted uppercase">
            Game
          </span>
          {gameSlug && selectedGame ? (
            <Chip
              data-active="true"
              onClick={clearGame}
              aria-label={`Clear game filter: ${selectedGame.name}`}
              title={selectedGame.name}
            >
              <GameIcon
                src={selectedGame.iconUrl ?? selectedGame.logoUrl}
                name={selectedGame.name}
              />
              {selectedGame.name}
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
                    <GameIcon
                      src={g.iconUrl ?? g.logoUrl}
                      name={g.name}
                      size="sm"
                    />
                    <span className="truncate">{g.name}</span>
                    <span className="ml-auto text-xs font-semibold text-foreground-muted tabular-nums">
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
