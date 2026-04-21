import { FlameIcon, UsersIcon } from "lucide-react"

import { Chip } from "@workspace/ui/components/chip"
import { GameIcon } from "@workspace/ui/components/game-icon"
import { cn } from "@workspace/ui/lib/utils"

import type { FeedFilter } from "../../../lib/feed-api"
import { useFeedChipsQuery } from "../../../lib/feed-queries"

type FeedChipBarProps = {
  filter: FeedFilter
  onChange: (next: FeedFilter) => void
}

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
        "sticky top-0 z-10 -mx-4 px-4 py-2 backdrop-blur",
        "bg-background/80 border-b border-border"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 overflow-x-auto",
          // Hide the scrollbar on the chip row; a visible bar adds
          // visual noise and the row is horizontally scannable by
          // wheel/drag regardless.
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        )}
      >
        <Chip
          size="xl"
          data-active={
            isActive(filter, { kind: "foryou" }) ? "true" : undefined
          }
          onClick={() => onChange({ kind: "foryou" })}
        >
          <FlameIcon />
          Für dich
        </Chip>
        <Chip
          size="xl"
          data-active={
            isActive(filter, { kind: "following" }) ? "true" : undefined
          }
          onClick={() => onChange({ kind: "following" })}
        >
          <UsersIcon />
          Gefolgt
        </Chip>

        {games.map((g) => (
          <Chip
            key={g.id}
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
        ))}
      </div>
    </div>
  )
}
