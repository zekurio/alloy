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
 * Slides are a fixed legible width rather than a count-derived fraction, so the
 * number visible flows naturally with the viewport (and the rest scrolls)
 * instead of snapping between the old 3-up and 5-up layouts. A full-width card
 * with a peek on mobile cues that the deck scrolls; from `sm` up each slide
 * holds 380px to match `ClipGrid`'s fixed column width, so a deck card and a
 * grid card on the same page are the same width — wide enough for the avatar +
 * title + meta rows to breathe without cropping the `author · game` line.
 */
export function TopClipsRow({ items }: { items: readonly TopClipsRowItem[] }) {
  return (
    <TopClipsCarousel>
      {items.map(({ row }) => (
        <CarouselItem
          key={row.id}
          className="basis-[88%] pl-0 sm:basis-[380px]"
        >
          <ClipCardTrigger row={row} />
        </CarouselItem>
      ))}
    </TopClipsCarousel>
  )
}
