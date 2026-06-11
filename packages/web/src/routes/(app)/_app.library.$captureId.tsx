import { createFileRoute, redirect } from "@tanstack/react-router"
import * as React from "react"

import { LibraryEditorPage } from "@/components/routes/library/library-editor-page"
import { alloyDesktop } from "@/lib/desktop"

export const Route = createFileRoute("/(app)/_app/library/$captureId")({
  beforeLoad: () => {
    if (!alloyDesktop()) throw redirect({ to: "/" })
  },
  component: LibraryCaptureRoute,
})

function LibraryCaptureRoute() {
  const { captureId } = Route.useParams()
  return (
    <React.Suspense fallback={null}>
      <LibraryEditorPage captureId={captureId} />
    </React.Suspense>
  )
}
