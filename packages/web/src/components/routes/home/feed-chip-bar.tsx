import type { FeedFilter } from "@alloy/api"
import { t } from "@alloy/i18n"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { Link } from "@tanstack/react-router"
import { GlobeIcon, UsersIcon } from "lucide-react"

import {
  FilterChipRail,
  type FilterChipOption,
} from "@/components/clip/filter-chip-rail"
import { useFeedChipsQuery } from "@/lib/feed-queries"
import type { HomeSearch } from "@/lib/home-search"

const SCOPE_ALL = "all"
const SCOPE_FOLLOWING = "following"

type FeedChipBarProps = {
  filter: FeedFilter
  search: HomeSearch
}

function filterKey(filter: FeedFilter): string {
  if (filter.kind === "game") return `game:${filter.gameId}`
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

export function FeedChipBar({ filter, search }: FeedChipBarProps) {
  const { data } = useFeedChipsQuery()
  const games = data?.games ?? []
  const activeKey = filterKey(filter)

  const options: FilterChipOption<string>[] = [
    { key: SCOPE_ALL, label: t("All"), icon: <GlobeIcon /> },
    { key: SCOPE_FOLLOWING, label: t("Following"), icon: <UsersIcon /> },
    ...games.map((game) => ({
      key: `game:${game.id}`,
      label: game.name,
      icon: <GameIcon src={game.iconUrl ?? game.logoUrl} name={game.name} />,
    })),
  ]

  return (
    <FilterChipRail
      options={options}
      activeKey={activeKey}
      renderOptionLink={(option) => (
        <Link to="/" search={searchForKey(search, option.key)} />
      )}
    />
  )
}
