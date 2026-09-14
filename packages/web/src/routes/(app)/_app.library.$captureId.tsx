import { createFileRoute, redirect } from "@tanstack/react-router"
import { Suspense, lazy } from "react"

import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"
import { alloyDesktop } from "@/lib/desktop"
import {
  type LibrarySearch,
  type LibrarySearchInput,
  parseLibrarySearch,
} from "@/lib/library-search"

const loadLibraryEditorPage = async () => {
  const module = await import("@/components/routes/library/library-editor-page")
  return { default: module.LibraryEditorPage }
}

const LibraryEditorPage = lazy(loadLibraryEditorPage)

type LibraryEditorSearch = LibrarySearch & {
  prompt?: "game"
}

interface LibraryEditorSearchInput extends LibrarySearchInput {
  prompt?: unknown
}

function parseLibraryEditorSearch(
  search: LibraryEditorSearchInput,
): LibraryEditorSearch {
  // The library grid's filters ride along so prev/next and "back" mirror it.
  const parsed: LibraryEditorSearch = parseLibrarySearch(search)
  if (search.prompt === "game") parsed.prompt = "game"
  return parsed
}

export const Route = createFileRoute("/(app)/_app/library/$captureId")({
  validateSearch: parseLibraryEditorSearch,
  beforeLoad: async ({ context }) => {
    await requireStrictAuthBeforeLoad({ context })
    if (!alloyDesktop()) throw redirect({ to: "/" })
  },
  loader: () => {
    void loadLibraryEditorPage()
  },
  component: LibraryCaptureRoute,
})

function LibraryCaptureRoute() {
  const { captureId } = Route.useParams()
  const { prompt } = Route.useSearch()
  return (
    <Suspense fallback={null}>
      <LibraryEditorPage captureId={captureId} promptGame={prompt === "game"} />
    </Suspense>
  )
}
