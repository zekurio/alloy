import { MEDIA_FILTERS } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { GlobeIcon } from "lucide-react"

import {
  FilterChipRail,
  type FilterChipOption,
} from "@/components/clip/filter-chip-rail"
import { MediaFilterControl } from "@/components/clip/media-filter-control"
import {
  SortDropdown,
  type SortDropdownOption,
} from "@/components/clip/sort-dropdown"
import { GameIcon } from "@/components/game/game-icon"
import {
  profileClipSearchFor,
  type ProfileClipSort,
} from "@/lib/profile-all-search"

export type ProfileClipTab = "all" | "tagged"

type GameOption = {
  slug: string
  name: string
  iconUrl: string | null
  logoUrl: string | null
}

type ClipsFilterBarProps = {
  username: string
  tab: ProfileClipTab
  sort: ProfileClipSort
  gameSlug: string | null
  gameOptions: GameOption[]
}

const SORT_OPTIONS: ReadonlyArray<SortDropdownOption<ProfileClipSort>> = [
  { key: "recent", label: t("Newest") },
  { key: "oldest", label: t("Oldest") },
  { key: "views", label: t("Most viewed") },
]

const ALL_GAMES = "__all"

export function ClipsFilterBar({
  username,
  tab,
  sort,
  gameSlug,
  gameOptions,
}: ClipsFilterBarProps) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const media = MEDIA_FILTERS.find((value) => value === search.media) ?? "all"
  const to = PROFILE_CLIP_ROUTES[tab]
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
              to={to}
              params={{ username }}
              search={profileClipSearchFor(
                sort,
                opt.key === ALL_GAMES ? null : opt.key,
                media,
              )}
              data-active={active ? "true" : undefined}
            />
          )}
        />
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <MediaFilterControl
          value={media}
          onChange={(next) => {
            void navigate({
              to,
              params: { username },
              search: profileClipSearchFor(sort, gameSlug, next),
            })
          }}
        />
        <SortDropdown
          value={sort}
          options={SORT_OPTIONS}
          renderOptionLink={(opt, active) => (
            <Link
              to={to}
              params={{ username }}
              search={profileClipSearchFor(opt.key, gameSlug, media)}
              data-active={active ? "true" : undefined}
            />
          )}
        />
      </div>
    </>
  )
}

const PROFILE_CLIP_ROUTES = {
  all: "/u/$username/all",
  tagged: "/u/$username/tagged",
} as const
