import { FlameIcon, UsersIcon } from "lucide-react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@workspace/ui/components/carousel"
import { Chip } from "@workspace/ui/components/chip"
import { GameIcon } from "@workspace/ui/components/game-icon"
import { cn } from "@workspace/ui/lib/utils"

import type { FeedFilter } from "@workspace/api"
import { useFeedChipsQuery } from "@/lib/feed-queries"

type FeedChipBarProps = {
  filter: FeedFilter
  onChange: (next: FeedFilter) => void
}

const CHEVRON_CLASS =
  "z-10 rounded-none border-transparent bg-transparent text-white shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-9 [&_svg]:stroke-[2.5]"

function isActive(filter: FeedFilter, candidate: FeedFilter): boolean {
  if (filter.kind !== candidate.kind) return false
  if (filter.kind === "game" && candidate.kind === "game") {
    return filter.gameId === candidate.gameId
  }
  return true
}

export function FeedChipBar({ filter, onChange }: FeedChipBarProps) {
  const { data } = useFeedChipsQuery()
  const games = data?.games ?? []

  return (
    <div
      className={cn(
        "sticky top-0 z-10 -mx-4 px-4 py-2",
        "border-b border-border bg-background"
      )}
    >
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

          {games.map((g) => (
            <CarouselItem key={g.id} className="basis-auto pl-2">
              <Chip
                size="xl"
                data-active={
                  isActive(filter, { kind: "game", gameId: g.id })
                    ? "true"
                    : undefined
                }
                onClick={() => onChange({ kind: "game", gameId: g.id })}
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
