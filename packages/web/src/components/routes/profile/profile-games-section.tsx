import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { useInfiniteQuery } from "@tanstack/react-query"

import {
  ContentEmptyState,
  EmptyState,
} from "@/components/feedback/empty-state"
import { GameCard } from "@/components/game/game-card"
import { GamesGrid } from "@/components/routes/games/games-grid"
import { profileGamesQueryOptions } from "@/lib/user-queries"

export function ProfileGamesSection({ username }: { username: string }) {
  const query = useInfiniteQuery(profileGamesQueryOptions(username))
  if (!query.data) {
    return query.isError ? (
      <EmptyState title={t("Couldn't load games")} />
    ) : (
      <LoadingState />
    )
  }
  const games = query.data.pages.flat()
  if (games.length === 0)
    return (
      <ContentEmptyState
        seed={`profile-games-${username}`}
        title={t("No games yet")}
      />
    )
  return (
    <section>
      <GamesGrid>
        {games.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            link={{ kind: "user-clips", username, slug: game.slug }}
          />
        ))}
      </GamesGrid>
      {query.hasNextPage ? (
        <Button
          className="mt-6"
          variant="secondary"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage()
          }}
        >
          {t("Load more")}
        </Button>
      ) : null}
    </section>
  )
}
