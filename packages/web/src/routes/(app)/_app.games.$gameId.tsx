import { createFileRoute, Outlet } from "@tanstack/react-router"
import { Suspense, lazy } from "react"

import { feedInfiniteQueryOptions } from "@/lib/feed-queries"
import { gameQueryOptions } from "@/lib/game-queries"
import { gameClipsSort, parseGameSearch } from "@/lib/game-search"

const loadGameDetailPageInner = async () => {
  const module =
    await import("@/components/routes/game-detail/game-detail-page-inner")
  return { default: module.GameDetailPageInner }
}

const GameDetailPageInner = lazy(loadGameDetailPageInner)

export const Route = createFileRoute("/(app)/_app/games/$gameId")({
  validateSearch: parseGameSearch,
  loaderDeps: ({ search }) => ({
    sort: search.sort,
    creator: search.creator,
  }),
  loader: ({ context, deps, params }) => {
    const gamePromise = context.queryClient.fetchQuery(
      gameQueryOptions(params.gameId, context.session?.user.id ?? null),
    )
    void loadGameDetailPageInner()
    void gamePromise
      .then((game) =>
        context.queryClient.prefetchInfiniteQuery(
          feedInfiniteQueryOptions(
            { kind: "game", gameId: game.id, authorId: deps.creator },
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
    <Suspense fallback={null}>
      <GameDetailPageInner
        gameId={gameId}
        sort={sort}
        creator={search.creator ?? null}
      />
      <Outlet />
    </Suspense>
  )
}
