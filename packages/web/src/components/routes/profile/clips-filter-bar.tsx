import { t as tx } from "@alloy/i18n"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { Link, useNavigate } from "@tanstack/react-router"
import { GlobeIcon } from "lucide-react"

import {
  FilterDropdown,
  type FilterDropdownOption,
} from "@/components/clip/filter-dropdown"
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
  triggerVariant?: "chip" | "icon"
}

const SORT_OPTIONS: ReadonlyArray<SortDropdownOption<ProfileAllSort>> = [
  { key: "recent", label: tx("Newest") },
  { key: "oldest", label: tx("Oldest") },
  { key: "top", label: tx("Most liked") },
  { key: "views", label: tx("Most viewed") },
]

const ALL_GAMES = "__all"

export function ClipsFilterBar({
  username,
  sort,
  gameSlug,
  gameOptions,
  triggerVariant = "chip",
}: ClipsFilterBarProps) {
  const navigate = useNavigate()
  const gameFilterOptions: FilterDropdownOption<string>[] = [
    { key: ALL_GAMES, label: tx("All games"), icon: <GlobeIcon /> },
    ...gameOptions.map((g) => ({
      key: g.slug,
      label: g.name,
      icon: <GameIcon src={g.iconUrl ?? g.logoUrl} name={g.name} />,
      count: g.count,
    })),
  ]

  return (
    <>
      <SortDropdown
        triggerLabel={tx("Sort clips")}
        triggerVariant={triggerVariant}
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

      {gameOptions.length > 0 ? (
        <FilterDropdown
          triggerLabel={tx("Filter by game")}
          triggerVariant={triggerVariant}
          value={gameSlug ?? ALL_GAMES}
          options={gameFilterOptions}
          searchPlaceholder={tx("Search games…")}
          onSelect={(key) => {
            void navigate({
              to: "/u/$username/all",
              params: { username },
              search: profileAllSearchFor(sort, key === ALL_GAMES ? null : key),
            })
          }}
        />
      ) : null}
    </>
  )
}
