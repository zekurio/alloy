import { useRouter } from "@tanstack/react-router"
import { useCallback, useState } from "react"

import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import { goBackInBrowserHistory } from "@/lib/browser-url"
import { clipPermalink } from "@/lib/clip-navigation"

/**
 * The viewer dialog for a clip permalink. `gameId` is the route's game scope:
 * closing without history to go back to lands on that game, or home.
 */
export function ClipPermalinkModal({
  clipId,
  gameId,
}: {
  clipId: string
  gameId: string | null
}) {
  const router = useRouter()
  // The dialog runs ahead of the route: it shows the next clip before the
  // permalink navigation lands, and closes before the history entry pops. A
  // new `clipId` from the route takes over again.
  const [modal, setModal] = useState<{ route: string; id: string | null }>({
    route: clipId,
    id: clipId,
  })
  if (modal.route !== clipId) setModal({ route: clipId, id: clipId })
  const modalClipId = modal.route === clipId ? modal.id : clipId

  const handleClose = useCallback(() => {
    setModal((current) => ({ ...current, id: null }))
    if (goBackInBrowserHistory()) return
    if (gameId) {
      void router.navigate({
        to: "/games/$gameId",
        params: { gameId },
        replace: true,
      })
      return
    }
    void router.navigate({ to: "/", replace: true })
  }, [router, gameId])

  // Entries without a game move to the game-agnostic permalink instead of
  // inheriting this route's game scope.
  const handleNavigate = useCallback(
    (entry: { id: string; gameId: string | null }) => {
      setModal((current) => ({ ...current, id: entry.id }))
      void router.navigate({
        ...clipPermalink(entry.id, entry.gameId),
        search: {},
        replace: true,
      })
    },
    [router],
  )

  return (
    <ClipViewerDialog
      clipId={modalClipId}
      onClose={handleClose}
      onNavigate={handleNavigate}
    />
  )
}
