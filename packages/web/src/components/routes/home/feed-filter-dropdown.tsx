import type { FeedFilter } from "@alloy/api"
import { t } from "@alloy/i18n"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { useNavigate } from "@tanstack/react-router"
import { GlobeIcon, UsersIcon } from "lucide-react"

import {
  FilterDropdown,
  type FilterDropdownOption,
} from "@/components/clip/filter-dropdown"
import { useFeedChipsQuery } from "@/lib/feed-queries"
import type { HomeSearch } from "@/lib/home-search"

type FeedFilterDropdownProps = {
  filter: FeedFilter
  search: HomeSearch
  triggerVariant?: "chip" | "icon"
}

const SCOPE_ALL = "all"
const SCOPE_FOLLOWING = "following"

function filterKey(filter: FeedFilter): string {
  if (filter.kind === "game") return `game:${filter.steamgriddbId}`
  return filter.kind
}

/** Search params that select a given scope while preserving the active sort. */
function searchForKey(search: HomeSearch, key: string): HomeSearch {
  if (key === SCOPE_FOLLOWING) {
    return { ...search, feed: "following", game: undefined }
  }
  if (key.startsWith("game:")) {
    return { ...search, feed: undefined, game: key.slice("game:".length) }
  }
  return { ...search, feed: undefined, game: undefined }
}

export function FeedFilterDropdown({
  filter,
  search,
  triggerVariant,
}: FeedFilterDropdownProps) {
  const navigate = useNavigate()
  const { data } = useFeedChipsQuery()
  const games = data?.games ?? []

  const options: FilterDropdownOption<string>[] = [
    { key: SCOPE_ALL, label: t("All"), icon: <GlobeIcon /> },
    { key: SCOPE_FOLLOWING, label: t("Following"), icon: <UsersIcon /> },
    ...games.map((g) => ({
      key: `game:${g.steamgriddbId}`,
      label: g.name,
      icon: <GameIcon src={g.iconUrl ?? g.logoUrl} name={g.name} />,
    })),
  ]

  return (
    <FilterDropdown
      value={filterKey(filter)}
      options={options}
      triggerLabel={t("Filter")}
      triggerVariant={triggerVariant}
      searchPlaceholder={t("Search games…")}
      onSelect={(key) => {
        void navigate({ to: "/", search: searchForKey(search, key) })
      }}
    />
  )
}
