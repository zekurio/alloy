import type { FeedFilter } from "alloy-api"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "alloy-ui/components/carousel"
import { Chip } from "alloy-ui/components/chip"
import { GameIcon } from "alloy-ui/components/game-icon"
import { cn } from "alloy-ui/lib/utils"
import { FlameIcon, HashIcon, UsersIcon } from "lucide-react"

import { useFeedChipsQuery } from "@/lib/feed-queries"

type FeedChipBarProps = {
  filter: FeedFilter
  onChange: (next: FeedFilter) => void
}

const CHEVRON_CLASS =
  "z-10 rounded-none border-transparent bg-transparent text-muted-foreground shadow-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] hover:border-transparent hover:bg-transparent hover:text-foreground hover:shadow-none hover:drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] [&_svg]:!size-4 [&_svg]:stroke-[2]"

function isActive(filter: FeedFilter, candidate: FeedFilter): boolean {
  if (filter.kind !== candidate.kind) return false
  if (filter.kind === "game" && candidate.kind === "game") {
    return filter.steamgriddbId === candidate.steamgriddbId
  }
  if (filter.kind === "hashtag" && candidate.kind === "hashtag") {
    return filter.tag === candidate.tag
  }
  return true
}

export function FeedChipBar({ filter, onChange }: FeedChipBarProps) {
  const { data } = useFeedChipsQuery()
  const games = data?.games ?? []

  return (
    <div className={cn("sticky top-0 z-10 -mx-4 px-4 py-5", "bg-background")}>
      <Carousel className="group" opts={{ align: "start", dragFree: true }}>
        <CarouselContent className="-ml-2">
          <CarouselItem className="basis-auto pl-2">
            <Chip
              size="xl"
              data-active={
                isActive(filter, { kind: "foryou" }) ? "true" : undefined
              }
              onClick={() => onChange({ kind: "foryou" })}
            >
              <FlameIcon />
              For you
            </Chip>
          </CarouselItem>
          <CarouselItem className="basis-auto pl-2">
            <Chip
              size="xl"
              data-active={
                isActive(filter, { kind: "following" }) ? "true" : undefined
              }
              onClick={() => onChange({ kind: "following" })}
            >
              <UsersIcon />
              Following
            </Chip>
          </CarouselItem>
          {filter.kind === "hashtag" ? (
            <CarouselItem className="basis-auto pl-2">
              <Chip size="xl" data-active="true" title={`#${filter.tag}`}>
                <HashIcon />#{filter.tag}
              </Chip>
            </CarouselItem>
          ) : null}

          {games.map((g) => (
            <CarouselItem key={g.id} className="basis-auto pl-2">
              <Chip
                size="xl"
                data-active={
                  isActive(filter, {
                    kind: "game",
                    steamgriddbId: g.steamgriddbId,
                  })
                    ? "true"
                    : undefined
                }
                onClick={() =>
                  onChange({ kind: "game", steamgriddbId: g.steamgriddbId })
                }
                title={g.name}
              >
                <GameIcon src={g.iconUrl ?? g.logoUrl} name={g.name} />
                {g.name}
              </Chip>
            </CarouselItem>
          ))}
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
    </div>
  )
}
