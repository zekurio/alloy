import { CheckIcon, SparklesIcon, XIcon } from "lucide-react"

import type { GameRow, SteamGridDBSearchResult } from "@workspace/api"
import { Button } from "@workspace/ui/components/button"
import { GameIcon } from "@workspace/ui/components/game-icon"
import { cn } from "@workspace/ui/lib/utils"

import { useCyclingVerb } from "./game-suggestion-verbs"

interface GameSuggestionProps {
  /** `analyzing` while frames/resolve are in flight, `ready` once art lands. */
  status: "analyzing" | "ready"
  /** The SGDB-backed suggestion preview. Present when `status === "ready"`. */
  game?: GameSuggestionGame | null
  accepting?: boolean
  onAccept: () => void
  onDecline: () => void
}

type GameSuggestionGame =
  & Pick<
    GameRow | SteamGridDBSearchResult,
    "name" | "iconUrl"
  >
  & {
    logoUrl?: string | null
  }

/**
 * Advisory game guess rendered *inside* the SteamGridDB field (as an overlay
 * matching the input's frame). Shows a twinkling "thinking" state while the
 * model works, then the SGDB search preview, which the user can accept
 * (commits the game) or decline.
 */
export function GameSuggestion({
  status,
  game,
  accepting = false,
  onAccept,
  onDecline,
}: GameSuggestionProps) {
  const verb = useCyclingVerb(status === "analyzing")

  return (
    <div
      className={cn(
        "flex h-full w-full items-center gap-2 rounded-lg border border-accent-border bg-input px-3",
        "ring-2 ring-accent-border/20 ring-inset",
      )}
      aria-live="polite"
    >
      {status === "analyzing"
        ? (
          <>
            <SparklesIcon className="size-4 shrink-0 text-accent" aria-hidden />
            <span className="animate-text-shimmer min-w-0 flex-1 truncate text-sm font-medium">
              {verb}…
            </span>
          </>
        )
        : (
          <>
            <SparklesIcon
              className="size-3.5 shrink-0 text-accent"
              aria-hidden
            />
            <GameIcon
              src={game?.iconUrl ?? game?.logoUrl}
              name={game?.name ?? "?"}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {game?.name}
            </span>
            <Button
              type="button"
              variant="accent-outline"
              size="icon-sm"
              onClick={onAccept}
              disabled={accepting}
              aria-label={`Use ${game?.name ?? "suggested game"}`}
            >
              <CheckIcon className="size-3.5" />
            </Button>
          </>
        )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onDecline}
        disabled={accepting}
        aria-label="Dismiss suggestion"
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  )
}
