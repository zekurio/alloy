import { createFileRoute } from "@tanstack/react-router"
import * as React from "react"

import { LibraryClipEditorPage } from "@/components/routes/library/library-clip-editor-page"

export const Route = createFileRoute("/(app)/_app/library/c/$clipId")({
  component: LibraryClipRoute,
})

function LibraryClipRoute() {
  const { clipId } = Route.useParams()
  return (
    <React.Suspense fallback={null}>
      <LibraryClipEditorPage clipId={clipId} />
    </React.Suspense>
  )
}
