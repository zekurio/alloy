import { createFileRoute } from "@tanstack/react-router"
import * as React from "react"

import { LibraryStagingEditorPage } from "@/components/routes/library/library-staging-editor-page"

export const Route = createFileRoute("/(app)/_app/library/r/$recordingId")({
  component: LibraryStagingRoute,
})

function LibraryStagingRoute() {
  const { recordingId } = Route.useParams()
  return (
    <React.Suspense fallback={null}>
      <LibraryStagingEditorPage recordingId={recordingId} />
    </React.Suspense>
  )
}
