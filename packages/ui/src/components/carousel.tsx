"use client"

import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import useEmblaCarousel, {
  type UseEmblaCarouselType,
} from "embla-carousel-react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import type { ComponentProps, KeyboardEvent } from "react"

type CarouselApi = NonNullable<UseEmblaCarouselType[1]>
type CarouselOptions = Parameters<typeof useEmblaCarousel>[0]

type CarouselContextValue = {
  carouselRef: UseEmblaCarouselType[0]
  scrollPrev: () => void
  scrollNext: () => void
  canScrollPrev: boolean
  canScrollNext: boolean
  /** True once Embla has completed its first layout pass. */
  settled: boolean
}

const CarouselContext = createContext<CarouselContextValue | null>(null)

function useCarousel() {
  const context = useContext(CarouselContext)

  if (!context) {
    throw new Error("useCarousel must be used within a <Carousel />")
  }

  return context
}

/** Horizontal Embla carousel with arrow-key and edge-button navigation. */
function Carousel({
  opts,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { opts?: CarouselOptions }) {
  const [carouselRef, api] = useEmblaCarousel(opts)
  const [canScrollPrev, setCanScrollPrev] = useState(false)
  const [canScrollNext, setCanScrollNext] = useState(false)
  const [settled, setSettled] = useState(false)

  const onSelect = useCallback((emblaApi: CarouselApi) => {
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

/** Edge fade masks: soften clipped slides at whichever edges can scroll. */
const FADE_BOTH =
  "[mask-image:linear-gradient(to_right,transparent,black_2rem,black_calc(100%-2rem),transparent)]"
const FADE_LEFT =
  "[mask-image:linear-gradient(to_right,transparent,black_2rem)]"
const FADE_RIGHT =
  "[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]"

function edgeFadeClass(canScrollPrev: boolean, canScrollNext: boolean) {
  if (canScrollPrev && canScrollNext) return FADE_BOTH
  if (canScrollPrev) return FADE_LEFT
  if (canScrollNext) return FADE_RIGHT
  return undefined
}

function CarouselContent({
  className,
  edgeFade = false,
  ...props
}: ComponentProps<"div"> & {
  /** Fade out clipped slides at scrollable edges instead of hard-cutting. */
  edgeFade?: boolean
}) {
  const carousel = useCarousel()

  return (
    <div
      ref={carousel.carouselRef}
      className={cn(
        "[transform:translateZ(0)] overflow-hidden [contain:paint] [backface-visibility:hidden]",
        edgeFade &&
          edgeFadeClass(carousel.canScrollPrev, carousel.canScrollNext),
      )}
      data-slot="carousel-content"
    >
      <div
        className={cn(
          "-ml-4 flex [transform:translateZ(0)] [backface-visibility:hidden]",
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CarouselItem({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="group"
      aria-roledescription="slide"
      data-slot="carousel-item"
      className={cn(
        "relative isolate min-w-0 shrink-0 grow-0 basis-full pl-4 [transform:translateZ(0)] [contain:paint] [backface-visibility:hidden]",
        className,
      )}
      {...props}
    />
  )
}

function CarouselControl({
  direction,
  className,
  size = "icon-sm",
  variant = "outline",
  ...props
}: ComponentProps<typeof Button> & { direction: "previous" | "next" }) {
  const carousel = useCarousel()
  const previous = direction === "previous"

  return (
    <Button
      data-slot={`carousel-${direction}`}
      variant={variant}
      size={size}
      className={cn(
        "absolute top-1/2 -translate-y-1/2 touch-manipulation rounded-full",
        "disabled:pointer-events-none disabled:hidden",
        previous ? "left-2" : "right-2",
        !carousel.settled && "!hidden",
        className,
      )}
      disabled={previous ? !carousel.canScrollPrev : !carousel.canScrollNext}
      onClick={previous ? carousel.scrollPrev : carousel.scrollNext}
      {...props}
    >
      {previous ? <ChevronLeftIcon /> : <ChevronRightIcon />}
      <span className="sr-only">
        {previous ? t("Previous slide") : t("Next slide")}
      </span>
    </Button>
  )
}

function CarouselPrevious(props: ComponentProps<typeof Button>) {
  return <CarouselControl direction="previous" {...props} />
}

function CarouselNext(props: ComponentProps<typeof Button>) {
  return <CarouselControl direction="next" {...props} />
}

export {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
}
