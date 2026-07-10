import { t } from "@alloy/i18n"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { AlertCircleIcon } from "lucide-react"

import { EmptyState } from "@/components/feedback/empty-state"
import { GameCard } from "@/components/game/game-card"
import { useGamesListQuery } from "@/lib/game-queries"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

import { GamesGrid } from "./games-grid"

function GamesEmpty() {
  return (
    <EmptyState
      kaomoji
      seed="games-empty"
      size="lg"
      title={t("No games yet")}
      hint={t("Upload a clip and pick a game to seed this list.")}
    />
  )
}

export function GamesSection() {
  const { data: games, error, isPending } = useGamesListQuery()
  useQueryErrorToast(error, {
    title: t("Couldn't load games"),
    toastId: "games-list-error",
  })
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
        <EmptyState
          icon={AlertCircleIcon}
          size="lg"
          title={t("Couldn't load games")}
        />
      ) : isPending ? (
        <LoadingState />
      ) : (
        <GamesEmpty />
      )}
    </section>
  )
}
