import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "alloy-ui/components/carousel"
import { cn } from "alloy-ui/lib/utils"
import * as React from "react"

const CHEVRON_CLASS =
  "z-10 rounded-none border-transparent bg-transparent text-muted-foreground shadow-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] hover:border-transparent hover:bg-transparent hover:text-foreground hover:shadow-none hover:drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] [&_svg]:!size-4 [&_svg]:stroke-[2]"

type FilterCarouselProps = {
  /**
   * Each child becomes one slide in a horizontally-scrolling chip rail.
   * Nullish/false children (conditional chips) are skipped, and arrays of
   * chips (e.g. `items.map(...)`) are flattened into individual slides.
   */
  children: React.ReactNode
  className?: string
}

/**
 * Shared horizontally-scrolling chip rail used by every filter bar — the home
 * feed, profile clips, library sources, and the profile "all" games filter.
 * It owns the carousel wiring and the prev/next chevrons so call sites only
 * supply the chips, keeping the bars visually and behaviourally identical.
 */
export function FilterCarousel({ children, className }: FilterCarouselProps) {
  return (
    <Carousel
      className={cn("group", className)}
      opts={{ align: "start", dragFree: true }}
    >
      <CarouselContent className="-ml-2">
        {React.Children.map(children, (child) =>
          child == null ? null : (
            <CarouselItem className="basis-auto pl-2">{child}</CarouselItem>
          ),
        )}
      </CarouselContent>
      <CarouselPrevious
        variant="ghost"
        size="icon"
        className={cn("left-2", CHEVRON_CLASS)}
      />
      <CarouselNext
        variant="ghost"
        size="icon"
        className={cn("right-2", CHEVRON_CLASS)}
      />
    </Carousel>
  )
}
