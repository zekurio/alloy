import * as React from "react"
import { GamepadIcon } from "lucide-react"

import {
  buildGameCarouselEntries,
  GameCarouselSection,
  type GameCarouselEntry,
} from "@/components/game/game-carousel-section"
import type { UserClip } from "@workspace/api"

type GamesSectionProps = {
  clips: UserClip[] | null
  username?: string
}

export function GamesSection({ clips, username }: GamesSectionProps) {
  const games = React.useMemo<GameCarouselEntry[] | null>(
    () => (clips === null ? null : buildGameCarouselEntries(clips)),
    [clips]
  )

  return (
    <GameCarouselSection
      entries={games}
      title={
        <>
          <GamepadIcon className="text-accent" />
          Recently clipped
        </>
      }
      emptySeed="profile-games-empty"
      emptyTitle="No games yet"
      emptyHint="Upload a clip to start the list."
      renderLink={(game) =>
        username && game.slug
          ? { kind: "user-clips", username, slug: game.slug }
          : undefined
      }
    />
  )
}
