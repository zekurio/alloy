import * as React from "react"

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
import { GameCard, type GameCardData, type GameCardLink } from "./game-card"
import type { ClipRow } from "@workspace/api"

export type GameCarouselEntry = GameCardData & { count: number }

type GameCarouselSectionProps = {
  entries: GameCarouselEntry[] | null
  title: React.ReactNode
  emptyTitle: string
  emptyHint: string
  emptySeed: string
  skeletonSeedCount?: number
  renderLink?: (entry: GameCarouselEntry) => GameCardLink | undefined
}

type GameBucket = {
  name: string
  slug: string | null
  heroUrl: string | null
  gridUrl: string | null
  logoUrl: string | null
  count: number
}

const ITEM_CLASS = "basis-auto pl-4"
const CARD_CLASS = "w-48"

export function buildGameCarouselEntries(
  clips: Array<Pick<ClipRow, "game" | "gameRef">>,
  limit = 12
): GameCarouselEntry[] {
  const buckets = new Map<string, GameBucket>()
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
        gridUrl: clip.gameRef?.gridUrl ?? null,
        logoUrl: clip.gameRef?.logoUrl ?? null,
        count: 0,
      }
      buckets.set(key, bucket)
      order.push(key)
    }

    bucket.count += 1
  }

  return order.slice(0, limit).map((key) => {
    const bucket = buckets.get(key)
    if (!bucket) {
      throw new Error(`Missing bucket for ${key}`)
    }

    return {
      name: bucket.name,
      slug: bucket.slug,
      heroUrl: bucket.heroUrl,
      gridUrl: bucket.gridUrl,
      logoUrl: bucket.logoUrl,
      count: bucket.count,
    }
  })
}

export function GameCarouselSection({
  entries,
  title,
  emptyTitle,
  emptyHint,
  emptySeed,
  skeletonSeedCount = 5,
  renderLink,
}: GameCarouselSectionProps) {
  return (
    <section className="mb-6">
      <SectionHead>
        <div>
          <SectionTitle>{title}</SectionTitle>
        </div>
        <SectionActions>
          {entries && entries.length > 0 ? (
            <SectionMeta>
              {entries.length} {entries.length === 1 ? "game" : "games"}
            </SectionMeta>
          ) : null}
        </SectionActions>
      </SectionHead>

      {entries === null ? (
        <Carousel className="group" opts={{ align: "start", dragFree: true }}>
          <CarouselContent>
            {Array.from({ length: skeletonSeedCount }).map((_, i) => (
              <CarouselItem key={i} className={ITEM_CLASS}>
                <Skeleton className={`aspect-[2/3] ${CARD_CLASS} rounded-md`} />
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      ) : entries.length === 0 ? (
        <EmptyState
          seed={emptySeed}
          size="md"
          title={emptyTitle}
          hint={emptyHint}
        />
      ) : (
        <Carousel className="group" opts={{ align: "start", dragFree: true }}>
          <CarouselContent>
            {entries.map((entry) => (
              <CarouselItem
                key={entry.slug ?? `name:${entry.name}`}
                className={ITEM_CLASS}
              >
                <GameCard
                  game={entry}
                  className={CARD_CLASS}
                  link={renderLink?.(entry)}
                />
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious
            variant="ghost"
            size="icon-lg"
            className="left-2 z-10 rounded-none border-transparent bg-transparent text-white shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-8 [&_svg]:stroke-[2.5]"
          />
          <CarouselNext
            variant="ghost"
            size="icon-lg"
            className="right-2 z-10 rounded-none border-transparent bg-transparent text-white shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-8 [&_svg]:stroke-[2.5]"
          />
        </Carousel>
      )}
    </section>
  )
}
