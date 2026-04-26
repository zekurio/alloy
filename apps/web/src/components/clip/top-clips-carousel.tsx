import * as React from "react"

import {
  Carousel,
  CarouselContent,
  CarouselNext,
  CarouselPrevious,
} from "@workspace/ui/components/carousel"

export function TopClipsCarousel({ children }: { children: React.ReactNode }) {
  return (
    <Carousel className="group" opts={{ align: "start" }}>
      <CarouselContent className="ml-0 md:-ml-4">{children}</CarouselContent>
      <CarouselPrevious
        variant="ghost"
        size="icon"
        className="top-[calc(50%-1.75rem)] left-2 z-10 rounded-none border-transparent bg-transparent text-white shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-9 [&_svg]:stroke-[2.5]"
      />
      <CarouselNext
        variant="ghost"
        size="icon"
        className="top-[calc(50%-1.75rem)] right-2 z-10 rounded-none border-transparent bg-transparent text-white shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-9 [&_svg]:stroke-[2.5]"
      />
    </Carousel>
  )
}
