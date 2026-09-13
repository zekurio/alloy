import { createFileRoute } from "@tanstack/react-router"
import { Suspense, lazy } from "react"

import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"
import { clipDetailQueryOptions } from "@/lib/clip-queries"
import { parseLibrarySearch } from "@/lib/library-search"

const loadLibraryClipEditorPage = async () => {
  const module =
    await import("@/components/routes/library/library-clip-editor-page")
  return { default: module.LibraryClipEditorPage }
}

const LibraryClipEditorPage = lazy(loadLibraryClipEditorPage)

export const Route = createFileRoute("/(app)/_app/library/clips/$clipId")({
  // The library grid's filters ride along so prev/next and "back" mirror it.
  validateSearch: parseLibrarySearch,
  beforeLoad: requireStrictAuthBeforeLoad,
  loader: ({ context, params }) => {
    void loadLibraryClipEditorPage()
    void context.queryClient.prefetchQuery(
      clipDetailQueryOptions(params.clipId, { keepPreviousData: false }),
    )
  },
  component: LibraryClipRoute,
})

function LibraryClipRoute() {
  const { clipId } = Route.useParams()
  return (
    <Suspense fallback={null}>
      <LibraryClipEditorPage clipId={clipId} />
    </Suspense>
  )
}
