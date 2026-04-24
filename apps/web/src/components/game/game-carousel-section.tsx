import * as React from "react"

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

/* Responsive: 3 → 4 → 5 → 6 columns with 10px gap (gap-2.5) */
const GRID_CLASS =
  "flex flex-wrap justify-center gap-2.5"
const ITEM_CLASS =
  "w-[calc((100%-20px)/3)] sm:w-[calc((100%-30px)/4)] lg:w-[calc((100%-40px)/5)] xl:w-[calc((100%-50px)/6)]"

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
        <div className={GRID_CLASS}>
          {Array.from({ length: skeletonSeedCount }).map((_, i) => (
            <div key={i} className={ITEM_CLASS}>
              <Skeleton className="aspect-[2/3] w-full rounded-md" />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          seed={emptySeed}
          size="md"
          title={emptyTitle}
          hint={emptyHint}
        />
      ) : (
        <div className={GRID_CLASS}>
          {entries.map((entry) => (
            <div
              key={entry.slug ?? `name:${entry.name}`}
              className={ITEM_CLASS}
            >
              <GameCard
                game={entry}
                className="w-full"
                link={renderLink?.(entry)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
