import { t } from "@alloy/i18n"
import { Link } from "@tanstack/react-router"

import {
  SortDropdown,
  type SortDropdownOption,
} from "@/components/clip/sort-dropdown"
import { GameFilterRail } from "@/components/routes/game-filter-rail"
import {
  profileClipSearchFor,
  type ProfileClipSort,
} from "@/lib/profile-all-search"

export type ProfileClipTab = "all" | "screenshots"

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

export function ClipsFilterBar({
  username,
  tab,
  sort,
  gameSlug,
  gameOptions,
}: ClipsFilterBarProps) {
  const media = tab === "screenshots" ? "image" : "video"
  const to = PROFILE_CLIP_ROUTES[tab]

  return (
    <>
      {gameOptions.length > 0 ? (
        <GameFilterRail
          games={gameOptions}
          gameKey={(game) => game.slug}
          activeGame={gameSlug}
          renderLink={(game) => (
            <Link
              to={to}
              params={{ username }}
              search={profileClipSearchFor(sort, game ?? null, media)}
            />
          )}
        />
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
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
  screenshots: "/u/$username/screenshots",
} as const
