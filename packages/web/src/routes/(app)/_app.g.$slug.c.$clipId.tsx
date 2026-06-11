import { HttpError } from "@alloy/api"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import * as React from "react"

import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import { api } from "@/lib/api"
import { goBackInBrowserHistory } from "@/lib/browser-url"
import { seedClipDetailInCache } from "@/lib/clip-queries"
import { parseClipRouteSearch } from "@/lib/clip-route-search"

export const Route = createFileRoute("/(app)/_app/g/$slug/c/$clipId")({
  validateSearch: parseClipRouteSearch,
  loader: async ({ context, params }) => {
    try {
      const clip = await api.clips.fetchById(params.clipId)
      seedClipDetailInCache(context.queryClient, clip)
      return { clip }
    } catch (error) {
      if (
        error instanceof HttpError &&
        (error.status === 401 || error.status === 403 || error.status === 404)
      ) {
        throw redirect({
          to: "/g/$slug",
          params: { slug: params.slug },
          replace: true,
        })
      }
      throw error
    }
  },
  component: ClipModalRoute,
})

function ClipModalRoute() {
  const { slug, clipId } = Route.useParams()
  const { comment } = Route.useSearch()
  const router = useRouter()
  const [modalClipId, setModalClipId] = React.useState<string | null>(clipId)

  React.useEffect(() => {
    setModalClipId(clipId)
  }, [clipId])

  const handleClose = React.useCallback(() => {
    setModalClipId(null)
    // Prefer browser back so the previous screen (if any) is preserved
    // verbatim. Cold loads fall through to the game page.
    if (!goBackInBrowserHistory()) {
      void router.navigate({
        to: "/g/$slug",
        params: { slug },
        replace: true,
      })
    }
  }, [router, slug])

  const handleNavigate = React.useCallback(
    (entry: { id: string; gameSlug: string | null }) => {
      setModalClipId(entry.id)
      // Match the URL to the new clip so refreshes land on the right
      // page — fall back to the current slug when the entry is missing one.
      void router.navigate({
        to: "/g/$slug/c/$clipId",
        params: { slug: entry.gameSlug ?? slug, clipId: entry.id },
        search: {},
        replace: true,
      })
    },
    [router, slug],
  )

  return (
    <ClipViewerDialog
      clipId={modalClipId}
      focusedCommentId={comment ?? null}
      onClose={handleClose}
      onNavigate={handleNavigate}
    />
  )
}
