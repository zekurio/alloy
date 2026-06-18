import { createFileRoute, redirect } from "@tanstack/react-router"
import * as React from "react"

import { EditorPage } from "@/components/routes/editor/editor-page"
import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"
import { alloyDesktop } from "@/lib/desktop"

export const Route = createFileRoute("/(app)/_app/editor")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { capture?: string; draft?: string } => ({
    /** Library capture id the project starts with ("Open in Editor"). */
    capture: typeof search.capture === "string" ? search.capture : undefined,
    /** Saved project draft id to reopen. */
    draft: typeof search.draft === "string" ? search.draft : undefined,
  }),
  beforeLoad: async ({ context }) => {
    await requireStrictAuthBeforeLoad({ context })
    if (!alloyDesktop()) throw redirect({ to: "/" })
  },
  component: EditorRoute,
})

function EditorRoute() {
  const { capture, draft } = Route.useSearch()
  return (
    <React.Suspense fallback={null}>
      <EditorPage draftId={draft} seedCaptureId={capture} />
    </React.Suspense>
  )
}
