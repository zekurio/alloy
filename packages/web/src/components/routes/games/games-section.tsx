import { t } from "@alloy/i18n"
import { LoadingState } from "@alloy/ui/components/loading-state"

import { ContentEmptyState } from "@/components/feedback/empty-state"
import { GameCard } from "@/components/game/game-card"
import { LoadErrorState } from "@/components/routes/load-error"
import { useGamesListQuery } from "@/lib/game-queries"

import { GamesGrid } from "./games-grid"

function GamesEmpty() {
  return (
    <ContentEmptyState
      seed="games-empty"
      size="lg"
      title={t("No games yet")}
      hint={t("Upload a clip and pick a game to seed this list.")}
    />
  )
}

export function GamesSection() {
  const { data: games, error, isPending, refetch } = useGamesListQuery()
  return (
    <section>
      {games !== undefined ? (
        games.length === 0 ? (
          <GamesEmpty />
        ) : (
          <GamesGrid>
            {games.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                link={{ kind: "game", slug: g.slug }}
              />
            ))}
          </GamesGrid>
        )
      ) : error ? (
        <LoadErrorState
          title={t("Couldn't load games")}
          onRetry={() => void refetch()}
        />
      ) : isPending ? (
        <LoadingState />
      ) : (
        <GamesEmpty />
      )}
    </section>
  )
}
