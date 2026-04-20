import { GamepadIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { EmptyState } from "../../../components/empty-state"
import { useGamesListQuery } from "../../../lib/game-queries"
import { useQueryErrorToast } from "../../../lib/use-query-error-toast"
import { GameCard } from "./game-card"
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
            <span className="font-mono text-2xs text-foreground-faint">
              {visibleGames.length}{" "}
              {visibleGames.length === 1 ? "game" : "games"}
            </span>
          ) : null}
        </SectionActions>
      </SectionHead>

      {error ? (
        <EmptyState seed="games-error" size="lg" title="Couldn't load games" />
      ) : isPending || !games ? (
        <GamesGrid>
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-md" />
          ))}
        </GamesGrid>
      ) : games.length === 0 ? (
        <EmptyState
          seed="games-empty"
          size="lg"
          title="No games yet"
          hint="Upload a clip and pick a game to seed this list."
        />
      ) : (
        <GamesGrid>
          {games.map((g) => (
            <GameCard key={g.id} game={g} />
          ))}
        </GamesGrid>
      )}
    </section>
  )
}
