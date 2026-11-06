import { t } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router"

import { RouteNotFoundState } from "@/components/feedback/route-state"
import { GameDetailPageInner } from "@/components/routes/game-detail/game-detail-page-inner"
import { feedInfiniteQueryOptions } from "@/lib/feed-queries"
import { gameQueryOptions } from "@/lib/game-queries"
import { gameClipsSort, parseGameSearch } from "@/lib/game-search"
import { isHttpNotFound } from "@/lib/http-not-found"

export const Route = createFileRoute("/(app)/_app/games/$gameId")({
  validateSearch: parseGameSearch,
  loaderDeps: ({ search }) => ({
    sort: search.sort,
    creator: search.creator,
    media: search.media,
  }),
  loader: async ({ context, deps, params }) => {
    let game
    try {
      game = await context.queryClient.fetchQuery(
        gameQueryOptions(params.gameId),
      )
    } catch (error) {
      if (isHttpNotFound(error)) throw notFound()
      // Other failures stay on the page, which offers a retry.
      return
    }
    void context.queryClient.prefetchInfiniteQuery(
      feedInfiniteQueryOptions(
        {
          kind: "game",
          gameId: game.id,
          authorId: deps.creator,
          media: deps.media ?? "all",
        },
        gameClipsSort(deps),
      ),
    )
  },
  notFoundComponent: GameNotFound,
  component: GameDetailPage,
})

function GameNotFound() {
  return (
    <AppMain>
      <RouteNotFoundState
        variant="panel"
        title={t("Game not found")}
        description={t("This game doesn't exist.")}
      />
    </AppMain>
  )
}

function GameDetailPage() {
  const { gameId } = Route.useParams()
  const search = Route.useSearch()
  const sort = gameClipsSort(search)

  return (
    <>
      <GameDetailPageInner
        gameId={gameId}
        sort={sort}
        creator={search.creator ?? null}
      />
      <Outlet />
    </>
  )
}
