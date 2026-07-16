import type { RecordingAllowedGame } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { List, ListItem } from "@alloy/ui/components/list"
import { Gamepad2Icon, Trash2Icon } from "lucide-react"
import type { ReactNode } from "react"

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
  addIcon: ReactNode
  emptyText: string
  fallbackIcon: ReactNode
  onAdd: () => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="text-sm font-medium">{title}</div>
          <p className="text-foreground-dim text-xs">{description}</p>
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
        <List>
          {games.map((game) => (
            <ListItem key={game.id}>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="bg-surface-raised text-foreground-muted grid size-8 shrink-0 place-items-center rounded-md">
                  <GameIcon game={game} fallbackIcon={fallbackIcon} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {game.name}
                  </div>
                  <div className="text-foreground-dim mt-0.5 truncate text-xs">
                    {game.path ?? game.executable ?? game.windowClass}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                title={t("Remove {name}", { name: game.name })}
                aria-label={t("Remove {name}", { name: game.name })}
                className="shrink-0"
                onClick={() => onRemove(game.id)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </ListItem>
          ))}
        </List>
      ) : (
        <div className="text-foreground-dim flex items-center gap-2 text-xs">
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
  fallbackIcon?: ReactNode
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
