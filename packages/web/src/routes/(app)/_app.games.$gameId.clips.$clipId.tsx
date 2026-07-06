import { HttpError } from "@alloy/api"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"

import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import { goBackInBrowserHistory } from "@/lib/browser-url"
import { clipDetailQueryOptions } from "@/lib/clip-queries"
import { parseClipRouteSearch } from "@/lib/clip-route-search"

export const Route = createFileRoute("/(app)/_app/games/$gameId/clips/$clipId")(
  {
    validateSearch: parseClipRouteSearch,
    loader: async ({ context, params }) => {
      try {
        const clip = await context.queryClient.ensureQueryData(
          clipDetailQueryOptions(params.clipId),
        )
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
  },
)

function ClipModalRoute() {
  const { gameId, clipId } = Route.useParams()
  const { comment } = Route.useSearch()
  const router = useRouter()
  const [modalClipId, setModalClipId] = useState<string | null>(clipId)

  useEffect(() => {
    setModalClipId(clipId)
  }, [clipId])

  const handleClose = useCallback(() => {
    setModalClipId(null)
    if (!goBackInBrowserHistory()) {
      void router.navigate({
        to: "/games/$gameId",
        params: { gameId },
        replace: true,
      })
    }
  }, [router, gameId])

  const handleNavigate = useCallback(
    (entry: { id: string; gameId: string | null }) => {
      setModalClipId(entry.id)
      // Entries without a game move to the game-agnostic permalink instead
      // of inheriting this route's game scope.
      if (!entry.gameId) {
        void router.navigate({
          to: "/clips/$clipId",
          params: { clipId: entry.id },
          search: {},
          replace: true,
        })
        return
      }
      void router.navigate({
        to: "/games/$gameId/clips/$clipId",
        params: { gameId: entry.gameId, clipId: entry.id },
        search: {},
        replace: true,
      })
    },
    [router],
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
