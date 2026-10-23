import type { FeedFilter } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Link } from "@tanstack/react-router"

import { GameFilterRail } from "@/components/routes/game-filter-rail"
import { useFeedChipsQuery } from "@/lib/feed-queries"
import type { HomeSearch } from "@/lib/home-search"

type FeedChipBarProps = {
  to?: "/" | "/screenshots"
  filter: FeedFilter
  search: HomeSearch
}

export function FeedChipBar({ filter, search, to = "/" }: FeedChipBarProps) {
  const { data } = useFeedChipsQuery(filter.media)

  return (
    <GameFilterRail
      games={data?.games ?? []}
      gameKey={(game) => game.id}
      activeGame={filter.kind === "game" ? filter.gameId : null}
      allLabel={t("All")}
      // Switching the game keeps the active sort.
      renderLink={(game) => <Link to={to} search={{ ...search, game }} />}
    />
  )
}
