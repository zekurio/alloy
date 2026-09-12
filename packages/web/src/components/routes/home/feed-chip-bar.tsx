import type { FeedFilter } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Link } from "@tanstack/react-router"
import { GlobeIcon } from "lucide-react"

import {
  FilterChipRail,
  type FilterChipOption,
} from "@/components/clip/filter-chip-rail"
import { GameIcon } from "@/components/game/game-icon"
import { useFeedChipsQuery } from "@/lib/feed-queries"
import type { HomeSearch } from "@/lib/home-search"

const SCOPE_ALL = "all"

type FeedChipBarProps = {
  to?: "/" | "/screenshots"
  filter: FeedFilter
  search: HomeSearch
}

function filterKey(filter: FeedFilter): string {
  if (filter.kind === "game") return `game:${filter.gameId}`
  return filter.kind
}

/** Search params that select a given scope while preserving the active sort. */
function searchForKey(search: HomeSearch, key: string): HomeSearch {
  if (key.startsWith("game:")) {
    return { ...search, game: key.slice("game:".length) }
  }
  return { ...search, game: undefined }
}

export function FeedChipBar({ filter, search, to = "/" }: FeedChipBarProps) {
  const { data } = useFeedChipsQuery(filter.media)
  const games = data?.games ?? []
  const activeKey = filterKey(filter)

  const options: FilterChipOption<string>[] = [
    { key: SCOPE_ALL, label: t("All"), icon: <GlobeIcon /> },
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
        <Link to={to} search={searchForKey(search, option.key)} />
      )}
    />
  )
}
