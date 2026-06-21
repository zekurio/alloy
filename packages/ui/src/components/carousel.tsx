"use client"

import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  type CarouselApi,
  CarouselContext,
  type CarouselProps,
  useCarousel,
} from "@alloy/ui/hooks/use-carousel"
import { cn } from "@alloy/ui/lib/utils"
import useEmblaCarousel from "embla-carousel-react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import type { ComponentProps, KeyboardEvent, ReactNode } from "react"

function Carousel({
  orientation = "horizontal",
  opts,
  setApi,
  plugins,
  className,
  children,
  ...props
}: ComponentProps<"div"> & CarouselProps) {
  const [carouselRef, api] = useEmblaCarousel(
    {
      ...opts,
      axis: orientation === "horizontal" ? "x" : "y",
    },
    plugins,
  )
  const [canScrollPrev, setCanScrollPrev] = useState(false)
  const [canScrollNext, setCanScrollNext] = useState(false)
  const [settled, setSettled] = useState(false)

  const onSelect = useCallback((emblaApi: CarouselApi) => {
    if (!emblaApi) return
    setCanScrollPrev(emblaApi.canScrollPrev())
    setCanScrollNext(emblaApi.canScrollNext())
  }, [])

  const scrollPrev = useCallback(() => {
    api?.scrollPrev()
  }, [api])

  const scrollNext = useCallback(() => {
    api?.scrollNext()
  }, [api])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        scrollPrev()
        return
      }

      if (event.key === "ArrowRight") {
        event.preventDefault()
        scrollNext()
      }
    },
    [scrollPrev, scrollNext],
  )

  useEffect(() => {
    if (!api || !setApi) return
    setApi(api)
  }, [api, setApi])

  useEffect(() => {
    if (!api) return
    onSelect(api)

    // Mark settled after a rAF so the first layout pass has completed
    // and scroll state is accurate — prevents chevron flash on mount.
    const rafId = requestAnimationFrame(() => setSettled(true))

    api.on("reInit", onSelect)
    api.on("select", onSelect)

    return () => {
      cancelAnimationFrame(rafId)
      api.off("reInit", onSelect)
      api.off("select", onSelect)
    }
  }, [api, onSelect])

  return (
    <CarouselContext.Provider
      value={{
        carouselRef,
        api: api,
        opts,
        orientation,
        scrollPrev,
        scrollNext,
        canScrollPrev,
        canScrollNext,
        settled,
      }}
    >
      <div
        onKeyDownCapture={handleKeyDown}
        className={cn("relative", className)}
        role="region"
        aria-roledescription="carousel"
        data-slot="carousel"
        {...props}
      >
        {children}
      </div>
    </CarouselContext.Provider>
  )
}

function CarouselContent({ className, ...props }: ComponentProps<"div">) {
  const carousel = useCarousel()

  return (
    <div
      ref={carousel.carouselRef}
      className="[transform:translateZ(0)] overflow-hidden [contain:paint] [backface-visibility:hidden]"
      data-slot="carousel-content"
    >
      <div
        className={cn(
          "flex [transform:translateZ(0)] [backface-visibility:hidden]",
          carousel.orientation === "horizontal" ? "-ml-4" : "-mt-4 flex-col",
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CarouselItem({ className, ...props }: ComponentProps<"div">) {
  const carousel = useCarousel()

  return (
    <div
      role="group"
      aria-roledescription="slide"
      data-slot="carousel-item"
      className={cn(
        "relative isolate min-w-0 shrink-0 grow-0 basis-full [transform:translateZ(0)] [contain:paint] [backface-visibility:hidden]",
        carousel.orientation === "horizontal" ? "pl-4" : "pt-4",
        className,
      )}
      {...props}
    />
  )
}

function CarouselControl({
  children,
  className,
  dataSlot,
  disabled,
  onClick,
  orientation,
  position,
  size = "icon-sm",
  variant = "outline",
  ...props
}: ComponentProps<typeof Button> & {
  children: ReactNode
  dataSlot: string
  orientation: "horizontal" | "vertical"
  position: "next" | "previous"
}) {
  return (
    <Button
      data-slot={dataSlot}
      variant={variant}
      size={size}
      className={cn(
        "absolute touch-manipulation rounded-full",
        "disabled:pointer-events-none disabled:hidden",
        orientation === "horizontal"
          ? position === "previous"
            ? "top-1/2 -left-12 -translate-y-1/2"
            : "top-1/2 -right-12 -translate-y-1/2"
          : position === "previous"
            ? "-top-12 left-1/2 -translate-x-1/2 rotate-90"
            : "-bottom-12 left-1/2 -translate-x-1/2 rotate-90",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      {children}
    </Button>
  )
}

function CarouselPrevious({
  className,
  variant = "outline",
  size = "icon-sm",
  ...props
}: ComponentProps<typeof Button>) {
  const carousel = useCarousel()

  return (
    <CarouselControl
      dataSlot="carousel-previous"
      variant={variant}
      size={size}
      orientation={carousel.orientation}
      position="previous"
      className={cn(!carousel.settled && "!hidden", className)}
      disabled={!carousel.canScrollPrev}
      onClick={carousel.scrollPrev}
      {...props}
    >
      <ChevronLeftIcon />
      <span className="sr-only">{t("Previous slide")}</span>
    </CarouselControl>
  )
}

function CarouselNext({
  className,
  variant = "outline",
  size = "icon-sm",
  ...props
}: ComponentProps<typeof Button>) {
  const carousel = useCarousel()

  return (
    <CarouselControl
      dataSlot="carousel-next"
      variant={variant}
      size={size}
      orientation={carousel.orientation}
      position="next"
      className={cn(!carousel.settled && "!hidden", className)}
      disabled={!carousel.canScrollNext}
      onClick={carousel.scrollNext}
      {...props}
    >
      <ChevronRightIcon />
      <span className="sr-only">{t("Next slide")}</span>
    </CarouselControl>
  )
}

export {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
}
export type { CarouselApi }
