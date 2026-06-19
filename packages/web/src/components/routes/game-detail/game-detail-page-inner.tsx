import type { ClipFeedSort } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Spinner } from "@alloy/ui/components/spinner"
import { Link } from "@tanstack/react-router"
import * as React from "react"

import { SortDropdown } from "@/components/clip/sort-dropdown"
import { EmptyState } from "@/components/feedback/empty-state"
import { useHeaderToolbar } from "@/components/layout/header-toolbar"
import { createHeaderToolbarControls } from "@/components/layout/header-toolbar-controls"
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

  const toolbar = React.useMemo(() => {
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

    return createHeaderToolbarControls({
      desktop: (
        <SortDropdown
          value={sort}
          options={CLIP_SORT_OPTIONS}
          contentClassName="w-40"
          renderOptionLink={renderOptionLink}
        />
      ),
      mobile: (
        <SortDropdown
          triggerVariant="icon"
          triggerLabel={tx("Sort")}
          value={sort}
          options={CLIP_SORT_OPTIONS}
          contentClassName="!w-40 !min-w-40"
          renderOptionLink={renderOptionLink}
        />
      ),
    })
  }, [gameId, sort])
  useHeaderToolbar(toolbar)

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
            <div className="flex flex-col gap-4 px-4 pb-4 md:px-8 md:pb-6">
              <FeedSection
                filter={{ kind: "game", steamgriddbId: game.steamgriddbId }}
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
