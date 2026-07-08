import { t } from "@alloy/i18n"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { Link } from "@tanstack/react-router"
import { GlobeIcon } from "lucide-react"

import {
  FilterChipRail,
  type FilterChipOption,
} from "@/components/clip/filter-chip-rail"
import {
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
  gameOptions: GameOption[]
}

const SORT_OPTIONS: ReadonlyArray<SortDropdownOption<ProfileAllSort>> = [
  { key: "recent", label: t("Newest") },
  { key: "oldest", label: t("Oldest") },
  { key: "top", label: t("Most liked") },
  { key: "views", label: t("Most viewed") },
]

const ALL_GAMES = "__all"

export function ClipsFilterBar({
  username,
  sort,
  gameSlug,
  gameOptions,
}: ClipsFilterBarProps) {
  const gameFilterOptions: FilterChipOption<string>[] = [
    { key: ALL_GAMES, label: t("All games"), icon: <GlobeIcon /> },
    ...gameOptions.map((g) => ({
      key: g.slug,
      label: g.name,
      icon: <GameIcon src={g.iconUrl ?? g.logoUrl} name={g.name} />,
    })),
  ]

  return (
    <>
      {gameOptions.length > 0 ? (
        <FilterChipRail
          activeKey={gameSlug ?? ALL_GAMES}
          options={gameFilterOptions}
          renderOptionLink={(opt, active) => (
            <Link
              to="/u/$username/all"
              params={{ username }}
              search={profileAllSearchFor(
                sort,
                opt.key === ALL_GAMES ? null : opt.key,
              )}
              data-active={active ? "true" : undefined}
            />
          )}
        />
      ) : null}

      <div className="shrink-0">
        <SortDropdown
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
      </div>
    </>
  )
}
