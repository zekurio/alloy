import { GamepadIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionMeta,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { Spinner } from "@workspace/ui/components/spinner"

import { EmptyState } from "@/components/feedback/empty-state"
import { GameCard } from "@/components/game/game-card"
import { useGamesListQuery } from "@/lib/game-queries"
import { formatCount } from "@/lib/number-format"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"
import { GamesGrid } from "./games-grid"

export function GamesSection() {
  const { data: games, error, isPending } = useGamesListQuery()
  useQueryErrorToast(error, {
    title: "Couldn't load games",
    toastId: "games-list-error",
  })
  const visibleGames = games ?? null

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <GamepadIcon className="text-accent" />
            Games
          </SectionTitle>
        </div>
        <SectionActions>
          {visibleGames && visibleGames.length > 0 ? (
            <SectionMeta>
              {formatCount(visibleGames.length)}{" "}
              {visibleGames.length === 1 ? "game" : "games"}
            </SectionMeta>
          ) : null}
        </SectionActions>
      </SectionHead>

      {games !== undefined ? (
        games.length === 0 ? (
          <EmptyState
            seed="games-empty"
            size="lg"
            title="No games yet"
            hint="Upload a clip and pick a game to seed this list."
          />
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
        <EmptyState seed="games-error" size="lg" title="Couldn't load games" />
      ) : isPending ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : (
        <EmptyState
          seed="games-empty"
          size="lg"
          title="No games yet"
          hint="Upload a clip and pick a game to seed this list."
        />
      )}
    </section>
  )
}
