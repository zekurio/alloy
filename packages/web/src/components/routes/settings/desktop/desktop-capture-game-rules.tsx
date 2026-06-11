import type { RecordingAllowedGame } from "@alloy/contracts"
import { Button } from "@alloy/ui/components/button"
import { Gamepad2Icon, Trash2Icon } from "lucide-react"
import * as React from "react"

export function RuleGroup({
  title,
  description,
  games,
  busy,
  addLabel,
  addIcon,
  emptyText,
  fallbackIcon,
  onAdd,
  onRemove,
}: {
  title: string
  description: string
  games: RecordingAllowedGame[]
  busy: boolean
  addLabel: string
  addIcon: React.ReactNode
  emptyText: string
  fallbackIcon: React.ReactNode
  onAdd: () => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold">{title}</div>
          <p className="text-foreground-dim mt-0.5 text-xs">{description}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onAdd}
        >
          {addIcon}
          {addLabel}
        </Button>
      </div>

      {games.length > 0 ? (
        <div className="divide-border divide-y">
          {games.map((game) => (
            <div
              key={game.id}
              className="flex min-h-14 items-center gap-3 py-2.5"
            >
              <span className="bg-surface-raised text-foreground-muted grid size-8 shrink-0 place-items-center rounded-md">
                <GameIcon game={game} fallbackIcon={fallbackIcon} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{game.name}</div>
                <div className="text-foreground-dim mt-0.5 truncate text-xs">
                  {game.path ?? game.executable ?? game.windowClass}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                title={`Remove ${game.name}`}
                aria-label={`Remove ${game.name}`}
                onClick={() => onRemove(game.id)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-foreground-dim flex min-h-12 items-center gap-2 py-2 text-xs">
          <span className="bg-surface-raised grid size-8 shrink-0 place-items-center rounded-md">
            {fallbackIcon}
          </span>
          {emptyText}
        </div>
      )}
    </div>
  )
}

function GameIcon({
  game,
  fallbackIcon,
}: {
  game: RecordingAllowedGame
  fallbackIcon?: React.ReactNode
}) {
  if (game.iconUrl) {
    return (
      <img
        src={game.iconUrl}
        alt=""
        draggable={false}
        className="size-5 object-contain"
      />
    )
  }

  return fallbackIcon ?? <Gamepad2Icon className="size-4" />
}
