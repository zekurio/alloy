import { t as tx } from "@alloy/i18n"
import { LoadingState } from "@alloy/ui/components/loading-state"

import { EmptyState } from "@/components/feedback/empty-state"
import { GameCard } from "@/components/game/game-card"
import { useGamesListQuery } from "@/lib/game-queries"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

import { GamesGrid } from "./games-grid"

export function GamesSection() {
  const { data: games, error, isPending } = useGamesListQuery()
  useQueryErrorToast(error, {
    title: tx("Couldn't load games"),
    toastId: "games-list-error",
  })
  return (
    <section>
      {games !== undefined ? (
        games.length === 0 ? (
          <EmptyState
            seed="games-empty"
            size="lg"
            title={tx("No games yet")}
            hint={tx("Upload a clip and pick a game to seed this list.")}
          />
        ) : (
          <GamesGrid>
            {games.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                link={{ kind: "game", steamgriddbId: g.steamgriddbId }}
              />
            ))}
          </GamesGrid>
        )
      ) : error ? (
        <EmptyState
          seed="games-error"
          size="lg"
          title={tx("Couldn't load games")}
        />
      ) : isPending ? (
        <LoadingState />
      ) : (
        <EmptyState
          seed="games-empty"
          size="lg"
          title={tx("No games yet")}
          hint={tx("Upload a clip and pick a game to seed this list.")}
        />
      )}
    </section>
  )
}
