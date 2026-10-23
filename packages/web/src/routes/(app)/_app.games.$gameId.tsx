import { createFileRoute, Outlet } from "@tanstack/react-router"

import { GameDetailPageInner } from "@/components/routes/game-detail/game-detail-page-inner"
import { feedInfiniteQueryOptions } from "@/lib/feed-queries"
import { gameQueryOptions } from "@/lib/game-queries"
import { gameClipsSort, parseGameSearch } from "@/lib/game-search"

export const Route = createFileRoute("/(app)/_app/games/$gameId")({
  validateSearch: parseGameSearch,
  loaderDeps: ({ search }) => ({
    sort: search.sort,
    creator: search.creator,
    media: search.media,
  }),
  loader: ({ context, deps, params }) => {
    const gamePromise = context.queryClient.fetchQuery(
      gameQueryOptions(params.gameId),
    )
    void gamePromise
      .then((game) =>
        context.queryClient.prefetchInfiniteQuery(
          feedInfiniteQueryOptions(
            {
              kind: "game",
              gameId: game.id,
              authorId: deps.creator,
              media: deps.media ?? "all",
            },
            gameClipsSort(deps),
          ),
        ),
      )
      .catch(() => undefined)
  },
  component: GameDetailPage,
})

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
