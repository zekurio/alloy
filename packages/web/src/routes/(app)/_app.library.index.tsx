import { createFileRoute } from "@tanstack/react-router"
import { Suspense, lazy } from "react"

import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"
import { userClipsInfiniteQueryOptions } from "@/lib/clip-queries"
import {
  librarySort,
  libraryMedia,
  librarySource,
  parseLibrarySearch,
} from "@/lib/library-search"

const loadLibraryPage = async () => {
  const module = await import("@/components/routes/library/library-page")
  return { default: module.LibraryPage }
}

const LibraryPage = lazy(loadLibraryPage)

export const Route = createFileRoute("/(app)/_app/library/")({
  validateSearch: parseLibrarySearch,
  beforeLoad: requireStrictAuthBeforeLoad,
  loaderDeps: ({ search }) => ({ sort: librarySort(search) }),
  loader: ({ context, deps }) => {
    const handle = context.session?.user.username
    void loadLibraryPage()
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
    <Suspense fallback={null}>
      <LibraryPage
        sort={librarySort(search)}
        source={librarySource(search)}
        media={libraryMedia(search)}
      />
    </Suspense>
  )
}
