import type { ClipFeedSort } from "@alloy/api"
import type { MediaFilter } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { PageToolbar } from "@alloy/ui/components/page-toolbar"
import { Spinner } from "@alloy/ui/components/spinner"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { UsersIcon } from "lucide-react"

import {
  FilterChipRail,
  type FilterChipOption,
} from "@/components/clip/filter-chip-rail"
import { MediaFilterControl } from "@/components/clip/media-filter-control"
import { SortDropdown } from "@/components/clip/sort-dropdown"
import { FeedSection } from "@/components/routes/home/feed-section"
import { LoadErrorState } from "@/components/routes/load-error"
import { APP_BANNER_HEIGHT_CLASS } from "@/lib/banner-layout"
import { CLIP_SORT_OPTIONS, DEFAULT_CLIP_SORT } from "@/lib/clip-sort"
import { useGameCreatorsQuery, useGameQuery } from "@/lib/game-queries"
import type { GameSearch } from "@/lib/game-search"
import { useSuspenseSession } from "@/lib/session-suspense"
import { userChipData } from "@/lib/user-display"

import { GameHeader } from "./game-header"

const ALL_CREATORS = "__all"

type GameDetailPageInnerProps = {
  gameId: string
  sort: ClipFeedSort
  creator: string | null
}

/** Search params for the game page; the defaults stay out of the URL. */
function gamePageSearch(
  sort: ClipFeedSort,
  creator: string | null,
  media: MediaFilter,
): GameSearch {
  return {
    sort: sort === DEFAULT_CLIP_SORT ? undefined : sort,
    creator: creator ?? undefined,
    media: media === "video" ? undefined : media,
  }
}

export function GameDetailPageInner({
  gameId,
  sort,
  creator,
}: GameDetailPageInnerProps) {
  const { media = "video" } = useSearch({ from: "/(app)/_app/games/$gameId" })
  const navigate = useNavigate()
  const session = useSuspenseSession()
  const viewerId = session?.user.id

  const { data: game, error, refetch } = useGameQuery(gameId)
  // Creators across every media kind: when there are none the game has no
  // public posts at all, so there's nothing for the toolbar to filter.
  const { data: allCreators } = useGameCreatorsQuery(gameId, "all")
  const showToolbar = allCreators?.creators.length !== 0
  return (
    <AppMain className="!px-0 !pt-0">
      <div className="flex w-full flex-col">
        {game ? (
          <>
            <GameHeader game={game} />
            <div className="flex flex-col px-[var(--app-content-padding)]">
              {showToolbar ? (
                <PageToolbar rail={false}>
                  <GameCreatorChips
                    gameId={gameId}
                    sort={sort}
                    creator={creator}
                    media={media}
                  />
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <MediaFilterControl
                      value={media}
                      onChange={(media) => {
                        void navigate({
                          to: "/games/$gameId",
                          params: { gameId },
                          search: gamePageSearch(sort, creator, media),
                        })
                      }}
                    />

                    <SortDropdown
                      value={sort}
                      options={CLIP_SORT_OPTIONS}
                      contentClassName="w-40"
                      renderOptionLink={(opt, active) => (
                        <Link
                          to="/games/$gameId"
                          params={{ gameId }}
                          search={gamePageSearch(opt.key, creator, media)}
                          data-active={active ? "true" : undefined}
                        />
                      )}
                    />
                  </div>
                </PageToolbar>
              ) : null}
              <FeedSection
                filter={{
                  kind: "game",
                  media,
                  gameId: game.id,
                  authorId: creator ?? undefined,
                }}
                sort={sort}
                viewerId={viewerId}
              />
            </div>
          </>
        ) : error ? (
          <LoadErrorState
            title={t("Couldn't load this game")}
            onRetry={() => void refetch()}
          />
        ) : (
          <div
            className={`${APP_BANNER_HEIGHT_CLASS} flex w-full items-center justify-center`}
          >
            <Spinner className="size-6" />
          </div>
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
  media,
}: {
  gameId: string
  sort: ClipFeedSort
  creator: string | null
  media: MediaFilter
}) {
  const { data } = useGameCreatorsQuery(gameId, media)
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
              style={{
                backgroundColor: chip.avatar.bg,
                color: chip.avatar.fg,
              }}
            />
          </Avatar>
        ),
      }
    }),
  ]

  return (
    <FilterChipRail
      options={options}
      activeKey={creator ?? ALL_CREATORS}
      renderOptionLink={(opt) => (
        <Link
          to="/games/$gameId"
          params={{ gameId }}
          search={gamePageSearch(
            sort,
            opt.key === ALL_CREATORS ? null : opt.key,
            media,
          )}
        />
      )}
    />
  )
}
