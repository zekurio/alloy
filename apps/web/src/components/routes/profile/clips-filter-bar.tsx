import { Link, useNavigate } from "@tanstack/react-router"
import { Chip } from "@workspace/ui/components/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { GameIcon } from "@workspace/ui/components/game-icon"
import { ChevronDownIcon, XIcon } from "lucide-react"

import {
  filterLabelClass,
  SortDropdown,
  type SortDropdownOption,
} from "@/components/clip/sort-dropdown"
import {
  profileAllSearchFor,
  type ProfileAllSort,
} from "@/lib/profile-all-search"

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

const SORT_OPTIONS: ReadonlyArray<SortDropdownOption<ProfileAllSort>> = [
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

  const clearGame = () => {
    void navigate({
      to: "/u/$username/all",
      params: { username },
      search: profileAllSearchFor(sort, null),
      replace: true,
    })
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      {/* Sort group */}
      <SortDropdown
        label="Sort"
        value={sort}
        options={SORT_OPTIONS}
        renderOptionLink={(opt, active) => (
          <Link
            to="/u/$username/all"
            params={{ username }}
            search={profileAllSearchFor(opt.key, gameSlug)}
            data-active={active ? "true" : undefined}
          />
        )}
      />

      {/* Vertical divider */}
      {gameOptions.length > 0 ? (
        <span aria-hidden className="bg-border h-5 w-px" />
      ) : null}

      {/* Game filter */}
      {gameOptions.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <span className={filterLabelClass}>Game</span>
          {gameSlug && selectedGame ? (
            <Chip
              size="xl"
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
                  <Chip size="xl">
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
                        search={profileAllSearchFor(sort, g.slug)}
                      />
                    }
                  >
                    <GameIcon
                      src={g.iconUrl ?? g.logoUrl}
                      name={g.name}
                      size="sm"
                    />
                    <span className="truncate">{g.name}</span>
                    <span className="text-foreground-muted ml-auto text-xs font-semibold tabular-nums">
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
