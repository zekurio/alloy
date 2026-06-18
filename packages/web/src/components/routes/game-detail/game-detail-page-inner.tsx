import type { ClipFeedWindow } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Spinner } from "@alloy/ui/components/spinner"

import { EmptyState } from "@/components/feedback/empty-state"
import { APP_BANNER_HEIGHT_CLASS } from "@/lib/banner-layout"
import { useGameQuery } from "@/lib/game-queries"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

import { GameHeader } from "./game-header"
import { RecentClipsSection } from "./recent-clips-section"
import { GameTopClipsSection } from "./top-clips-section"

type GameDetailPageInnerProps = {
  gameId: string
  window: ClipFeedWindow
}

export function GameDetailPageInner({
  gameId,
  window,
}: GameDetailPageInnerProps) {
  const session = useSuspenseSession()
  const viewerId = session?.user.id

  const { data: game, error, isPending } = useGameQuery(gameId)
  useQueryErrorToast(error, {
    title: tx("Couldn't load this game"),
    toastId: `game-${gameId}-error`,
  })

  return (
    <AppMain className="!px-0 !py-0">
      <div className="flex w-full flex-col gap-6">
        {error ? (
          <EmptyState
            seed={`game-${gameId}-error`}
            size="lg"
            title={tx("Couldn't load this game")}
          />
        ) : isPending || !game ? (
          <div
            className={`${APP_BANNER_HEIGHT_CLASS} flex w-full items-center justify-center`}
          >
            <Spinner className="size-6" />
          </div>
        ) : (
          <>
            <GameHeader game={game} />
            <div className="flex flex-col gap-6 px-4 pb-4 md:px-8 md:pb-6">
              <GameTopClipsSection
                gameId={gameId}
                viewerId={viewerId}
                window={window}
              />
              <RecentClipsSection gameId={gameId} viewerId={viewerId} />
            </div>
          </>
        )}
      </div>
    </AppMain>
  )
}
