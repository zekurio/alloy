import { CarouselItem } from "@workspace/ui/components/carousel"
import type { ClipRow } from "@workspace/api"

import { ClipCardTrigger } from "./clip-card-trigger"
import { TopClipsCarousel } from "./top-clips-carousel"

export type TopClipsRowItem = {
  row: ClipRow
  owned: boolean
}

/**
 * Shared layout for the "Top clips" decks on home, game, and profile pages.
 *
 * A single carousel that shows 1, 3, or 5 cards per row (never the in-between
 * 2 or 4, which shrink the clips too far). At `xl` the five cards fill the row
 * and the scroller simply has nothing left to page through; below that it pages
 * through the deck.
 */
export function TopClipsRow({ items }: { items: readonly TopClipsRowItem[] }) {
  return (
    <TopClipsCarousel>
      {items.map(({ row, owned }) => (
        <CarouselItem
          key={row.id}
          className="basis-full pl-0 md:basis-1/3 md:pl-4 xl:basis-1/5"
        >
          <ClipCardTrigger row={row} owned={owned} />
        </CarouselItem>
      ))}
    </TopClipsCarousel>
  )
}
