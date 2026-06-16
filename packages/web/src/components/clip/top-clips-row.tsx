import type { ClipRow } from "@alloy/api"
import { CarouselItem } from "@alloy/ui/components/carousel"

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
 * 2 or 4, which read awkwardly). We hold the comfortable 3-up layout across the
 * whole common desktop range and only step up to 5 on genuinely wide (`2xl`)
 * viewports — five cards at `xl` shrank them too far. At the widest breakpoint
 * the cards fill the row and the scroller has nothing left to page through;
 * below that it pages through the deck.
 *
 * Slide widths subtract the visible `gap-3` gutters before division, otherwise
 * exact 3-up and 5-up decks leave a tiny scrollable remainder.
 */
export function TopClipsRow({ items }: { items: readonly TopClipsRowItem[] }) {
  return (
    <TopClipsCarousel>
      {items.map(({ row }) => (
        <CarouselItem
          key={row.id}
          className="basis-full pl-0 md:basis-[calc((100%_-_1.5rem)/3)] 2xl:basis-[calc((100%_-_3rem)/5)]"
        >
          <ClipCardTrigger row={row} />
        </CarouselItem>
      ))}
    </TopClipsCarousel>
  )
}
