import { createFileRoute, redirect } from "@tanstack/react-router"
import { Suspense, lazy } from "react"

import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"
import { alloyDesktop } from "@/lib/desktop"

const loadLibraryEditorPage = async () => {
  const module = await import("@/components/routes/library/library-editor-page")
  return { default: module.LibraryEditorPage }
}

const LibraryEditorPage = lazy(loadLibraryEditorPage)

interface LibraryEditorSearch {
  prompt?: "game"
}

function parseLibraryEditorSearch(search: {
  prompt?: unknown
}): LibraryEditorSearch {
  return search.prompt === "game" ? { prompt: "game" } : {}
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
