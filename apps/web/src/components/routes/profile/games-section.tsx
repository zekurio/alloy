import * as React from "react"
import { GamepadIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { EmptyState } from "../../../components/empty-state"
import { hueForGame } from "../../../lib/clip-format"
import type { UserClip } from "../../../lib/users-api"
import { GameTile, type GameEntry } from "./game-tile"
import { GamesRow } from "./games-row"

type GamesSectionProps = {
  clips: UserClip[] | null
  /**
   * When set, each tile links to this user's Clips tab with the game
   * pre-filtered. Leave undefined on surfaces that want non-interactive
   * game cards (e.g. embedded game detail previews).
   */
  username?: string
}

export function GamesSection({ clips, username }: GamesSectionProps) {
  const games = React.useMemo<GameEntry[] | null>(() => {
    if (clips === null) return null
    // Clips arrive sorted by createdAt DESC from the API. Walk them in order
    // and collect unique games by first occurrence (= most recent clip) so
    // the list reflects the 5 most recently clipped games.
    //
    // Prefer the resolved `gameRef` (carries a stable slug) so tiles can
    // link into the filtered Clips tab. Legacy rows with only a free-form
    // `clip.game` string fall through as non-linkable tiles — we still show
    // them so the user's history isn't hidden by a data migration gap.
    type Bucket = {
      name: string
      slug: string | null
      heroUrl: string | null
      logoUrl: string | null
      count: number
    }
    const buckets = new Map<string, Bucket>()
    const order: string[] = []
    for (const clip of clips) {
      const key = clip.gameRef?.slug ?? (clip.game ? `name:${clip.game}` : null)
      if (!key) continue
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = {
          name: clip.gameRef?.name ?? clip.game ?? "Unknown",
          slug: clip.gameRef?.slug ?? null,
          heroUrl: clip.gameRef?.heroUrl ?? null,
          logoUrl: clip.gameRef?.logoUrl ?? null,
          count: 0,
        }
        buckets.set(key, bucket)
        order.push(key)
      }
      bucket.count += 1
    }
    return order.slice(0, 5).map((key) => {
      const b = buckets.get(key)!
      return {
        name: b.name,
        slug: b.slug,
        heroUrl: b.heroUrl,
        logoUrl: b.logoUrl,
        count: b.count,
        hue: hueForGame(b.name),
      }
    })
  }, [clips])
  const visibleGames = games

  return (
    <section className="mb-10">
      <SectionHead>
        <div>
          <SectionTitle>
            <GamepadIcon className="text-accent" />
            Recently clipped
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

      {games === null ? (
        <GamesRow>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton
              key={i}
              className="aspect-video w-60 shrink-0 rounded-md"
            />
          ))}
        </GamesRow>
      ) : games.length === 0 ? (
        <EmptyState
          seed="profile-games-empty"
          size="md"
          title="No games yet"
          hint="Upload a clip to start the list."
        />
      ) : (
        <GamesRow>
          {games.map((g) => (
            <GameTile
              key={g.slug ?? `name:${g.name}`}
              game={g}
              username={username}
            />
          ))}
        </GamesRow>
      )}
    </section>
  )
}
