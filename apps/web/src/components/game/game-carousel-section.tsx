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
import { Spinner } from "@workspace/ui/components/spinner"

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

/* Mobile becomes a swipeable carousel showing 3 tiles at once.
 * sm+ keeps the responsive grid (more columns as space opens). */
const GRID_CLASS =
  "hidden sm:grid gap-2.5 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-11 2xl:grid-cols-[repeat(13,minmax(0,1fr))]"

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
  renderLink,
}: GameCarouselSectionProps) {
  return (
    <section>
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
        <div className="flex items-center justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          seed={emptySeed}
          size="md"
          title={emptyTitle}
          hint={emptyHint}
        />
      ) : (
        <>
          <Carousel className="group sm:hidden" opts={{ align: "start" }}>
            <CarouselContent className="-ml-2.5">
              {entries.map((entry) => (
                <CarouselItem
                  key={entry.slug ?? `name:${entry.name}`}
                  className="basis-1/3 pl-2.5"
                >
                  <GameCard
                    game={entry}
                    className="w-full"
                    link={renderLink?.(entry)}
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious
              variant="ghost"
              size="icon"
              className="top-1/2 left-1 z-10 -translate-y-1/2 rounded-none border-transparent bg-transparent text-white shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-7 [&_svg]:stroke-[2.5]"
            />
            <CarouselNext
              variant="ghost"
              size="icon"
              className="top-1/2 right-1 z-10 -translate-y-1/2 rounded-none border-transparent bg-transparent text-white shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-7 [&_svg]:stroke-[2.5]"
            />
          </Carousel>
          <div className={GRID_CLASS}>
            {entries.map((entry) => (
              <GameCard
                key={entry.slug ?? `name:${entry.name}`}
                game={entry}
                className="w-full"
                link={renderLink?.(entry)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
