import { t } from "@alloy/i18n"
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
  triggerVariant = "chip",
}: ClipsFilterBarProps) {
  const navigate = useNavigate()
  const gameFilterOptions: FilterDropdownOption<string>[] = [
    { key: ALL_GAMES, label: t("All games"), icon: <GlobeIcon /> },
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
        triggerLabel={t("Sort clips")}
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
          triggerLabel={t("Filter by game")}
          triggerVariant={triggerVariant}
          value={gameSlug ?? ALL_GAMES}
          options={gameFilterOptions}
          searchPlaceholder={t("Search games…")}
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
