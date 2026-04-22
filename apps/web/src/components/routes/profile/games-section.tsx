import * as React from "react"
import { GamepadIcon } from "lucide-react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@workspace/ui/components/carousel"
import {
  SectionActions,
  SectionHead,
  SectionMeta,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { EmptyState } from "@/components/feedback/empty-state"
import { GameCard, type GameCardData } from "@/components/game/game-card"
import type { UserClip } from "@/lib/users-api"

type GameEntry = GameCardData & { count: number }

type GamesSectionProps = {
  clips: UserClip[] | null
  username?: string
}

function buildGameEntries(clips: UserClip[]): GameEntry[] {
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

  return order.slice(0, 12).map((key) => {
    const bucket = buckets.get(key)
    if (!bucket) {
      throw new Error(`Missing bucket for ${key}`)
    }
    return {
      name: bucket.name,
      slug: bucket.slug,
      heroUrl: bucket.heroUrl,
      logoUrl: bucket.logoUrl,
      count: bucket.count,
    }
  })
}

const ITEM_CLASS = "basis-auto pl-4"
const CARD_CLASS = "w-72"

export function GamesSection({ clips, username }: GamesSectionProps) {
  const games = React.useMemo<GameEntry[] | null>(
    () => (clips === null ? null : buildGameEntries(clips)),
    [clips]
  )

  return (
    <section className="mb-6">
      <SectionHead>
        <div>
          <SectionTitle>
            <GamepadIcon className="text-accent" />
            Recently clipped
          </SectionTitle>
        </div>
        <SectionActions>
          {games && games.length > 0 ? (
            <SectionMeta>
              {games.length} {games.length === 1 ? "game" : "games"}
            </SectionMeta>
          ) : null}
        </SectionActions>
      </SectionHead>

      {games === null ? (
        <Carousel opts={{ align: "start", dragFree: true }}>
          <CarouselContent>
            {Array.from({ length: 5 }).map((_, i) => (
              <CarouselItem key={i} className={ITEM_CLASS}>
                <Skeleton className={`aspect-video ${CARD_CLASS} rounded-md`} />
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      ) : games.length === 0 ? (
        <EmptyState
          seed="profile-games-empty"
          size="md"
          title="No games yet"
          hint="Upload a clip to start the list."
        />
      ) : (
        <Carousel opts={{ align: "start", dragFree: true }}>
          <CarouselContent>
            {games.map((g) => (
              <CarouselItem
                key={g.slug ?? `name:${g.name}`}
                className={ITEM_CLASS}
              >
                <GameCard
                  game={g}
                  className={CARD_CLASS}
                  link={
                    username && g.slug
                      ? { kind: "user-clips", username, slug: g.slug }
                      : undefined
                  }
                />
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="-left-4" />
          <CarouselNext className="-right-4" />
        </Carousel>
      )}
    </section>
  )
}
