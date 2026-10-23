import { createFileRoute } from "@tanstack/react-router"

import { LibraryClipEditorPage } from "@/components/routes/library/library-clip-editor-page"
import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"
import { clipDetailQueryOptions } from "@/lib/clip-queries"
import { parseLibrarySearch } from "@/lib/library-search"

export const Route = createFileRoute("/(app)/_app/library/clips/$clipId")({
  // The library grid's filters ride along so prev/next and "back" mirror it.
  validateSearch: parseLibrarySearch,
  beforeLoad: requireStrictAuthBeforeLoad,
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      clipDetailQueryOptions(params.clipId, { keepPreviousData: false }),
    )
  },
  component: LibraryClipRoute,
})

function LibraryClipRoute() {
  const { clipId } = Route.useParams()
  return <LibraryClipEditorPage clipId={clipId} />
}
