import type { FeedFilter } from "@alloy/api"
import { Chip } from "@alloy/ui/components/chip"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { cn } from "@alloy/ui/lib/utils"
import { FlameIcon, UsersIcon } from "lucide-react"

import { FilterCarousel } from "@/components/filter-carousel"
import { useFeedChipsQuery } from "@/lib/feed-queries"

type FeedChipBarProps = {
  filter: FeedFilter
  onChange: (next: FeedFilter) => void
}

function isActive(filter: FeedFilter, candidate: FeedFilter): boolean {
  if (filter.kind !== candidate.kind) return false
  if (filter.kind === "game" && candidate.kind === "game") {
    return filter.igdbId === candidate.igdbId
  }
  return true
}

export function FeedChipBar({ filter, onChange }: FeedChipBarProps) {
  const { data } = useFeedChipsQuery()
  const games = data?.games ?? []

  return (
    <div
      className={cn(
        "sticky top-0 z-10 -mx-2 px-2 py-4 md:-mx-8 md:px-8",
        "bg-background",
      )}
    >
      <FilterCarousel>
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
        {games.map((g) => (
          <Chip
            key={g.id}
            size="xl"
            data-active={
              isActive(filter, {
                kind: "game",
                igdbId: g.igdbId,
              })
                ? "true"
                : undefined
            }
            onClick={() => onChange({ kind: "game", igdbId: g.igdbId })}
            title={g.name}
          >
            <GameIcon src={g.iconUrl ?? g.logoUrl} name={g.name} />
            {g.name}
          </Chip>
        ))}
      </FilterCarousel>
    </div>
  )
}
