import type { ClipFeedWindow } from "@alloy/api"
import { AppMain } from "@alloy/ui/components/app-shell"
import { cn } from "@alloy/ui/lib/utils"

import { EmptyState } from "@/components/feedback/empty-state"
import { useRequireAuth } from "@/lib/auth-hooks"
import { accentCssVars } from "@/lib/color"
import { useGameQuery } from "@/lib/game-queries"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

import {
  MediaPageBody,
  MediaPageBottomSpacer,
  MediaPageCard,
  MediaPageContent,
} from "../media-page-frame"
import { GameBackground } from "./game-background"
import { GameBanner } from "./game-banner"
import { GameIdentity } from "./game-identity"
import { GameIdentitySkeleton } from "./game-identity-skeleton"
import { RecentClipsSection } from "./recent-clips-section"
import { GameTopClipsSection } from "./top-clips-section"

type GameDetailPageInnerProps = {
  slug: string
  window: ClipFeedWindow
}

export function GameDetailPageInner({
  slug,
  window,
}: GameDetailPageInnerProps) {
  const session = useRequireAuth()
  const viewerId = session?.user.id

  const { data: game, error } = useGameQuery(slug)
  useQueryErrorToast(error, {
    title: "Couldn't load this game",
    toastId: `game-${slug}-error`,
  })

  const hasHero = Boolean(game?.heroUrl)
  // Retint the whole card to the game's accent (auto-derived from its hero
  // art), replacing the default lavender — the same treatment as profiles.
  const accentStyle = game?.accentColor
    ? accentCssVars(game.accentColor)
    : undefined

  return (
    <AppMain
      className={cn(
        "relative grid !px-0 !py-0",
        hasHero ? "bg-surface-sunken" : "bg-surface",
      )}
    >
      {/* Ambient blurred hero, sized to the scroll viewport and kept sticky so
          long pages cannot scroll past its crop. */}
      {hasHero ? (
        <div className="pointer-events-none sticky top-0 z-0 h-full min-w-0 [grid-area:1/1]">
          <GameBackground heroUrl={game?.heroUrl} />
        </div>
      ) : null}

      <MediaPageContent>
        <div className="mx-auto w-full max-w-[1800px] min-w-0">
          {error ? (
            <EmptyState
              seed={`game-${slug}-error`}
              size="lg"
              title="Couldn't load this game"
            />
          ) : (
            // Mobile uses the full viewport width; larger screens keep the
            // floating card treatment against the ambient backdrop.
            <MediaPageCard style={accentStyle}>
              {game?.heroUrl ? <GameBanner game={game} /> : null}

              <MediaPageBody>
                {game ? (
                  <GameIdentity game={game} hasBanner={hasHero} />
                ) : (
                  <GameIdentitySkeleton />
                )}

                <div className="flex flex-col gap-6 pt-2">
                  <GameTopClipsSection
                    slug={slug}
                    viewerId={viewerId}
                    window={window}
                  />
                  <RecentClipsSection slug={slug} viewerId={viewerId} />
                </div>
              </MediaPageBody>
            </MediaPageCard>
          )}
        </div>
        <MediaPageBottomSpacer />
      </MediaPageContent>
    </AppMain>
  )
}
