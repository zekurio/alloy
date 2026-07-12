import type { ClipFeedSort } from "@alloy/api"
import { t } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { PageToolbar } from "@alloy/ui/components/page-toolbar"
import { Spinner } from "@alloy/ui/components/spinner"
import { Link } from "@tanstack/react-router"
import { AlertCircleIcon, UsersIcon } from "lucide-react"

import {
  FilterChipRail,
  type FilterChipOption,
} from "@/components/clip/filter-chip-rail"
import { SortDropdown } from "@/components/clip/sort-dropdown"
import { EmptyState } from "@/components/feedback/empty-state"
import { FeedSection } from "@/components/routes/home/feed-section"
import { APP_BANNER_HEIGHT_CLASS } from "@/lib/banner-layout"
import { CLIP_SORT_OPTIONS, DEFAULT_CLIP_SORT } from "@/lib/clip-sort"
import { useGameCreatorsQuery, useGameQuery } from "@/lib/game-queries"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"
import { userChipData } from "@/lib/user-display"

import { GameHeader } from "./game-header"

const ALL_CREATORS = "__all"

type GameDetailPageInnerProps = {
  gameId: string
  sort: ClipFeedSort
  creator: string | null
}

export function GameDetailPageInner({
  gameId,
  sort,
  creator,
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
        // The default sort stays out of the URL, and so does "all creators".
        sort: opt.key === DEFAULT_CLIP_SORT ? undefined : opt.key,
        creator: creator ?? undefined,
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
      <div className="flex w-full flex-col">
        {error ? (
          <EmptyState
            icon={AlertCircleIcon}
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
              <PageToolbar rail={false}>
                <GameCreatorChips
                  gameId={gameId}
                  sort={sort}
                  creator={creator}
                />
                <div className="shrink-0">
                  <SortDropdown
                    value={sort}
                    options={CLIP_SORT_OPTIONS}
                    contentClassName="w-40"
                    renderOptionLink={renderOptionLink}
                  />
                </div>
              </PageToolbar>
              <FeedSection
                filter={{
                  kind: "game",
                  gameId: game.id,
                  authorId: creator ?? undefined,
                }}
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

/**
 * Creator chips — the game page's counterpart of the home feed's game chips:
 * narrows the game's feed to a single author. Hidden until the creators list
 * arrives (or when the game has no public clips).
 */
function GameCreatorChips({
  gameId,
  sort,
  creator,
}: {
  gameId: string
  sort: ClipFeedSort
  creator: string | null
}) {
  const { data } = useGameCreatorsQuery(gameId)
  const creators = data?.creators ?? []
  if (creators.length === 0) return null

  const options: FilterChipOption<string>[] = [
    { key: ALL_CREATORS, label: t("All users"), icon: <UsersIcon /> },
    ...creators.map((row) => {
      const chip = userChipData(row)
      return {
        key: row.id,
        label: chip.name,
        icon: (
          <Avatar size="sm">
            {chip.avatar.src ? (
              <AvatarImage src={chip.avatar.src} alt="" />
            ) : null}
            <AvatarFallback
              className="text-[8px]"
              style={{
                backgroundColor: chip.avatar.bg,
                color: chip.avatar.fg,
              }}
            >
              {chip.avatar.initials}
            </AvatarFallback>
          </Avatar>
        ),
      }
    }),
  ]

  return (
    <FilterChipRail
      options={options}
      activeKey={creator ?? ALL_CREATORS}
      renderOptionLink={(opt, active) => (
        <Link
          to="/games/$gameId"
          params={{ gameId }}
          search={{
            sort: sort === DEFAULT_CLIP_SORT ? undefined : sort,
            creator: opt.key === ALL_CREATORS ? undefined : opt.key,
          }}
          data-active={active ? "true" : undefined}
        />
      )}
    />
  )
}
