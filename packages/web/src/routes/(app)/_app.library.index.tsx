import { createFileRoute } from "@tanstack/react-router"
import * as React from "react"

import { LibraryPage } from "@/components/routes/library/library-page"

export const Route = createFileRoute("/(app)/_app/library/")({
  component: LibraryIndexPage,
})

function LibraryIndexPage() {
  return (
    <React.Suspense fallback={null}>
      <LibraryPage />
    </React.Suspense>
  )
}
