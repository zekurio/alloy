import type { ClipFeedSort } from "@alloy/api"
import { t } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { PageToolbar } from "@alloy/ui/components/page-toolbar"
import { Spinner } from "@alloy/ui/components/spinner"
import { Link } from "@tanstack/react-router"

import { SortDropdown } from "@/components/clip/sort-dropdown"
import { EmptyState } from "@/components/feedback/empty-state"
import { FeedSection } from "@/components/routes/home/feed-section"
import { APP_BANNER_HEIGHT_CLASS } from "@/lib/banner-layout"
import { CLIP_SORT_OPTIONS, DEFAULT_CLIP_SORT } from "@/lib/clip-sort"
import { useGameQuery } from "@/lib/game-queries"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

import { GameHeader } from "./game-header"

type GameDetailPageInnerProps = {
  gameId: string
  sort: ClipFeedSort
}

export function GameDetailPageInner({
  gameId,
  sort,
}: GameDetailPageInnerProps) {
  const session = useSuspenseSession()
  const viewerId = session?.user.id

  const renderOptionLink = (
    opt: (typeof CLIP_SORT_OPTIONS)[number],
    active: boolean,
  ) => (
    <Link
      to="/games/$gameId"
      params={{ gameId }}
      search={{
        // The default sort stays out of the URL.
        sort: opt.key === DEFAULT_CLIP_SORT ? undefined : opt.key,
      }}
      data-active={active ? "true" : undefined}
    />
  )

  const {
    data: game,
    error,
    isPending,
  } = useGameQuery(gameId, viewerId ?? null)
  useQueryErrorToast(error, {
    title: t("Couldn't load this game"),
    toastId: `game-${gameId}-error`,
  })

  return (
    <AppMain className="!px-0 !pt-0">
      <div className="flex w-full flex-col gap-6">
        {error ? (
          <EmptyState
            seed={`game-${gameId}-error`}
            size="lg"
            title={t("Couldn't load this game")}
          />
        ) : isPending || !game ? (
          <div
            className={`${APP_BANNER_HEIGHT_CLASS} flex w-full items-center justify-center`}
          >
            <Spinner className="size-6" />
          </div>
        ) : (
          <>
            <GameHeader game={game} viewerId={viewerId ?? null} />
            <div className="flex flex-col px-4 md:px-6">
              <PageToolbar>
                <SortDropdown
                  value={sort}
                  options={CLIP_SORT_OPTIONS}
                  contentClassName="w-40"
                  renderOptionLink={renderOptionLink}
                />
              </PageToolbar>
              <FeedSection
                filter={{ kind: "game", gameId: game.id }}
                sort={sort}
                viewerId={viewerId}
              />
            </div>
          </>
        )}
      </div>
    </AppMain>
  )
}
