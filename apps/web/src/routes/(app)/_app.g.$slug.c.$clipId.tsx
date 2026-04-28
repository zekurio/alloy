import * as React from "react"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"

import { HttpError } from "@workspace/api"

import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import { api } from "@/lib/api"
import { clipKeys } from "@/lib/clip-queries"

interface ClipRouteSearch {
  comment?: string
}

export const Route = createFileRoute("/(app)/_app/g/$slug/c/$clipId")({
  validateSearch: (search: Record<string, unknown>): ClipRouteSearch => {
    const comment = search.comment
    return typeof comment === "string" && comment.length > 0 ? { comment } : {}
  },
  loader: async ({ context, params }) => {
    try {
      const clip = await api.clips.fetchById(params.clipId)
      context.queryClient.setQueryData(clipKeys.detail(params.clipId), clip)
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
    if (router.history.length > 1) {
      router.history.back()
    } else {
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
    [router, slug]
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
