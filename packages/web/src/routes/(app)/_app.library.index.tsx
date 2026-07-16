import { createFileRoute } from "@tanstack/react-router"
import { Suspense, lazy } from "react"

import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"
import { userClipsQueryOptions } from "@/lib/clip-queries"
import {
  librarySort,
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
  loader: ({ context }) => {
    const handle = context.session?.user.username
    void loadLibraryPage()
    if (handle)
      void context.queryClient.prefetchQuery(userClipsQueryOptions(handle))
  },
  component: LibraryIndexPage,
})

function LibraryIndexPage() {
  const search = Route.useSearch()
  return (
    <Suspense fallback={null}>
      <LibraryPage sort={librarySort(search)} source={librarySource(search)} />
    </Suspense>
  )
}
