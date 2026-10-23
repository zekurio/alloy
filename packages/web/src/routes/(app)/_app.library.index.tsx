import { createFileRoute } from "@tanstack/react-router"

import { LibraryPage } from "@/components/routes/library/library-page"
import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"
import { userClipsInfiniteQueryOptions } from "@/lib/clip-queries"
import {
  librarySort,
  libraryMedia,
  librarySource,
  parseLibrarySearch,
} from "@/lib/library-search"

export const Route = createFileRoute("/(app)/_app/library/")({
  validateSearch: parseLibrarySearch,
  beforeLoad: requireStrictAuthBeforeLoad,
  loaderDeps: ({ search }) => ({ sort: librarySort(search) }),
  loader: ({ context, deps }) => {
    const handle = context.session?.user.username
    if (handle)
      void context.queryClient.prefetchInfiniteQuery(
        userClipsInfiniteQueryOptions(handle, deps.sort),
      )
  },
  component: LibraryIndexPage,
})

function LibraryIndexPage() {
  const search = Route.useSearch()
  return (
    <LibraryPage
      sort={librarySort(search)}
      source={librarySource(search)}
      media={libraryMedia(search)}
    />
  )
}
