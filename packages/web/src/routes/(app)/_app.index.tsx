import { createFileRoute } from "@tanstack/react-router"
import { Suspense, lazy } from "react"

import { DEFAULT_CLIP_SORT } from "@/lib/clip-sort"
import {
  feedChipsQueryOptions,
  feedInfiniteQueryOptions,
} from "@/lib/feed-queries"
import { homeFeedFilter, parseHomeSearch } from "@/lib/home-search"

const loadHomePageInner = async () => {
  const module = await import("@/components/routes/home/home-page-inner")
  return { default: module.HomePageInner }
}

const HomePageInner = lazy(loadHomePageInner)

export const Route = createFileRoute("/(app)/_app/")({
  validateSearch: parseHomeSearch,
  loaderDeps: ({ search }) => ({
    feed: search.feed,
    game: search.game,
    sort: search.sort,
  }),
  loader: ({ context, deps }) => {
    void loadHomePageInner()
    void context.queryClient.prefetchQuery(feedChipsQueryOptions())
    void context.queryClient.prefetchInfiniteQuery(
      feedInfiniteQueryOptions(
        homeFeedFilter(deps),
        deps.sort ?? DEFAULT_CLIP_SORT,
      ),
    )
  },
  component: HomePage,
})

function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageInner />
    </Suspense>
  )
}
