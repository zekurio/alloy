import { HttpError } from "@alloy/api"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import * as React from "react"

import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import { api } from "@/lib/api"
import { goBackInBrowserHistory } from "@/lib/browser-url"
import { seedClipDetailInCache } from "@/lib/clip-queries"
import { parseClipRouteSearch } from "@/lib/clip-route-search"

export const Route = createFileRoute("/(app)/_app/games/$gameId/c/$clipId")({
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
          to: "/games/$gameId",
          params: { gameId: params.gameId },
          replace: true,
        })
      }
      throw error
    }
  },
  component: ClipModalRoute,
})

function ClipModalRoute() {
  const { gameId, clipId } = Route.useParams()
  const { comment } = Route.useSearch()
  const router = useRouter()
  const [modalClipId, setModalClipId] = React.useState<string | null>(clipId)

  React.useEffect(() => {
    setModalClipId(clipId)
  }, [clipId])

  const handleClose = React.useCallback(() => {
    setModalClipId(null)
    if (!goBackInBrowserHistory()) {
      void router.navigate({
        to: "/games/$gameId",
        params: { gameId },
        replace: true,
      })
    }
  }, [router, gameId])

  const handleNavigate = React.useCallback(
    (entry: { id: string; gameId: string | null }) => {
      setModalClipId(entry.id)
      void router.navigate({
        to: "/games/$gameId/c/$clipId",
        params: { gameId: entry.gameId ?? gameId, clipId: entry.id },
        search: {},
        replace: true,
      })
    },
    [router, gameId],
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
