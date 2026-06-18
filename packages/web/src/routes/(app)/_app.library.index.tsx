import { createFileRoute } from "@tanstack/react-router"
import * as React from "react"

import { LibraryPage } from "@/components/routes/library/library-page"
import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"

export const Route = createFileRoute("/(app)/_app/library/")({
  beforeLoad: requireStrictAuthBeforeLoad,
  component: LibraryIndexPage,
})

function LibraryIndexPage() {
  return (
    <React.Suspense fallback={null}>
      <LibraryPage />
    </React.Suspense>
  )
}
