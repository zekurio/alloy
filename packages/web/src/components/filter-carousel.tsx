import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@alloy/ui/components/carousel"
import { cn } from "@alloy/ui/lib/utils"
import { Children } from "react"
import type { ReactNode } from "react"

const CHEVRON_CLASS = cn(
  "z-10 max-md:hidden rounded-none border-transparent bg-transparent",
  "text-foreground-muted shadow-none",
  "drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] transition-opacity",
  "hover:border-transparent hover:bg-transparent hover:text-foreground",
  "hover:shadow-none hover:drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]",
  "focus-visible:text-foreground",
  "md:pointer-events-none md:opacity-0",
  "md:group-hover:pointer-events-auto md:group-hover:opacity-100",
  "md:focus-visible:pointer-events-auto md:focus-visible:opacity-100",
  "[&_svg]:!size-4 [&_svg]:stroke-[2]",
)

type FilterCarouselProps = {
  children: ReactNode
  className?: string
}

export function FilterCarousel({ children, className }: FilterCarouselProps) {
  return (
    <Carousel
      className={cn("group", className)}
      opts={{ align: "start", dragFree: true }}
    >
      <CarouselContent className="-ml-2" edgeFade>
        {Children.map(children, (child) =>
          child == null ? null : (
            <CarouselItem className="basis-auto pl-2">{child}</CarouselItem>
          ),
        )}
      </CarouselContent>
      <CarouselPrevious
        variant="ghost"
        size="icon"
        className={cn("!left-2", CHEVRON_CLASS)}
      />
      <CarouselNext
        variant="ghost"
        size="icon"
        className={cn("!right-2", CHEVRON_CLASS)}
      />
    </Carousel>
  )
}
