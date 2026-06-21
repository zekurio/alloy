import { createFileRoute, redirect } from "@tanstack/react-router"
import { Suspense } from "react"

import { LibraryEditorPage } from "@/components/routes/library/library-editor-page"
import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"
import { alloyDesktop } from "@/lib/desktop"

export const Route = createFileRoute("/(app)/_app/library/$captureId")({
  validateSearch: (search: Record<string, unknown>): { prompt?: "game" } => ({
    prompt: search.prompt === "game" ? "game" : undefined,
  }),
  beforeLoad: async ({ context }) => {
    await requireStrictAuthBeforeLoad({ context })
    if (!alloyDesktop()) throw redirect({ to: "/" })
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
