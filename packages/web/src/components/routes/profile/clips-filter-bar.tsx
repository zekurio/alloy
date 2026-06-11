import { Chip } from "@alloy/ui/components/chip"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { Link } from "@tanstack/react-router"

import {
  filterLabelClass,
  SortDropdown,
  type SortDropdownOption,
} from "@/components/clip/sort-dropdown"
import { FilterCarousel } from "@/components/filter-carousel"
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
  gameOptions,
}: ClipsFilterBarProps) {
  return (
    <div className="mb-6 flex items-center gap-3">
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

      {/* Game filter rail */}
      {gameOptions.length > 0 ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className={filterLabelClass}>Game</span>
          <FilterCarousel className="min-w-0 flex-1">
            <Chip
              size="xl"
              data-active={gameSlug === null ? "true" : undefined}
              render={
                <Link
                  to="/u/$username/all"
                  params={{ username }}
                  search={profileAllSearchFor(sort, null)}
                  replace
                />
              }
            >
              All games
            </Chip>
            {gameOptions.map((g) => (
              <Chip
                key={g.slug}
                size="xl"
                data-active={g.slug === gameSlug ? "true" : undefined}
                title={g.name}
                render={
                  <Link
                    to="/u/$username/all"
                    params={{ username }}
                    search={profileAllSearchFor(sort, g.slug)}
                  />
                }
              >
                <GameIcon src={g.iconUrl ?? g.logoUrl} name={g.name} />
                <span className="max-w-[10rem] truncate">{g.name}</span>
                <span className="text-foreground-faint tabular-nums">
                  {g.count}
                </span>
              </Chip>
            ))}
          </FilterCarousel>
        </div>
      ) : null}
    </div>
  )
}
