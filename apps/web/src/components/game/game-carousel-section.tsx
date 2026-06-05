import {
  Carousel,
  type CarouselApi,
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
import * as React from "react"

import { EmptyState } from "@/components/feedback/empty-state"
import { headerCountLabel } from "@/lib/number-format"

import { GameCard, type GameCardData, type GameCardLink } from "./game-card"

export type GameCarouselEntry = GameCardData & { clipCount: number }

type GameCarouselSectionProps = {
  entries: GameCarouselEntry[] | null
  error?: unknown
  errorTitle?: string
  errorSeed?: string
  title: React.ReactNode
  emptyTitle: string
  emptyHint: string
  emptySeed: string
  renderLink?: (entry: GameCarouselEntry) => GameCardLink | undefined
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  onEndReached?: () => void
}

export function GameCarouselSection({
  entries,
  error = null,
  errorTitle = "Couldn't load games",
  errorSeed = "games-error",
  title,
  emptyTitle,
  emptyHint,
  emptySeed,
  renderLink,
  hasNextPage = false,
  isFetchingNextPage = false,
  onEndReached,
}: GameCarouselSectionProps) {
  const [api, setApi] = React.useState<CarouselApi>()

  const maybeLoadMore = React.useCallback(() => {
    if (
      !api ||
      !entries ||
      entries.length === 0 ||
      !hasNextPage ||
      isFetchingNextPage
    ) {
      return
    }
    if (api.slidesInView().includes(entries.length - 1)) {
      onEndReached?.()
    }
  }, [api, entries, hasNextPage, isFetchingNextPage, onEndReached])

  React.useEffect(() => {
    if (!api) return
    api.on("select", maybeLoadMore)
    api.on("reInit", maybeLoadMore)
    api.on("slidesInView", maybeLoadMore)
    maybeLoadMore()

    return () => {
      api.off("select", maybeLoadMore)
      api.off("reInit", maybeLoadMore)
      api.off("slidesInView", maybeLoadMore)
    }
  }, [api, maybeLoadMore])

  React.useEffect(() => {
    if (!api) return
    api.reInit()
    const rafId = requestAnimationFrame(maybeLoadMore)
    return () => cancelAnimationFrame(rafId)
  }, [api, entries?.length, maybeLoadMore])

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>{title}</SectionTitle>
        </div>
        <SectionActions>
          {entries && entries.length > 0 ? (
            <SectionMeta>
              {headerCountLabel(entries.length, "game")}
            </SectionMeta>
          ) : null}
        </SectionActions>
      </SectionHead>

      {entries === null && error ? (
        <EmptyState seed={errorSeed} size="md" title={errorTitle} />
      ) : entries === null ? (
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
        <Carousel className="group" opts={{ align: "start" }} setApi={setApi}>
          <CarouselContent className="-ml-2.5">
            {entries.map((entry) => (
              <CarouselItem
                key={entry.slug ?? `name:${entry.name}`}
                className="basis-1/3 pl-2.5 sm:basis-1/6 lg:basis-1/9 2xl:basis-1/12"
              >
                <GameCard
                  game={entry}
                  className="w-full"
                  link={renderLink?.(entry)}
                />
              </CarouselItem>
            ))}
            {isFetchingNextPage ? (
              <CarouselItem className="basis-1/3 pl-2.5 sm:basis-1/6 lg:basis-1/9 2xl:basis-1/12">
                <div className="bg-muted/30 flex aspect-[2/3] items-center justify-center rounded-md">
                  <Spinner className="size-5" />
                </div>
              </CarouselItem>
            ) : null}
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
      )}
    </section>
  )
}
