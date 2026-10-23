import { createFileRoute } from "@tanstack/react-router"

import { HomePageInner } from "@/components/routes/home/home-page-inner"
import { DEFAULT_CLIP_SORT } from "@/lib/clip-sort"
import {
  feedChipsQueryOptions,
  feedInfiniteQueryOptions,
} from "@/lib/feed-queries"
import { homeFeedFilter, parseHomeSearch } from "@/lib/home-search"

export const Route = createFileRoute("/(app)/_app/")({
  validateSearch: parseHomeSearch,
  loaderDeps: ({ search }) => ({
    game: search.game,
    sort: search.sort,
  }),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(feedChipsQueryOptions())
    void context.queryClient.prefetchInfiniteQuery(
      feedInfiniteQueryOptions(
        homeFeedFilter(deps),
        deps.sort ?? DEFAULT_CLIP_SORT,
      ),
    )
  },
  component: HomePageInner,
})
