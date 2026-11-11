import { createFileRoute } from "@tanstack/react-router"

import { HomePageInner } from "@/components/routes/home/home-page-inner"
import { parseHomeSearch, prefetchHomeFeed } from "@/lib/home-search"

export const Route = createFileRoute("/(app)/_app/")({
  validateSearch: parseHomeSearch,
  loaderDeps: ({ search }) => ({
    game: search.game,
    sort: search.sort,
  }),
  loader: ({ context, deps }) => {
    prefetchHomeFeed(context.queryClient, deps)
  },
  component: HomePage,
})

function HomePage() {
  return <HomePageInner search={Route.useSearch()} />
}
