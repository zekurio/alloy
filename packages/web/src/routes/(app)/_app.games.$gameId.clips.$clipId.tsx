import { createFileRoute } from "@tanstack/react-router"

import { ClipPermalinkModal } from "@/components/app/clip-permalink-modal"
import { ensureClipForPermalink } from "@/lib/clip-navigation"

export const Route = createFileRoute("/(app)/_app/games/$gameId/clips/$clipId")(
  {
    loader: ({ context, params }) =>
      ensureClipForPermalink(context.queryClient, params.clipId, params.gameId),
    component: ClipModalRoute,
  },
)

function ClipModalRoute() {
  const { gameId, clipId } = Route.useParams()
  return <ClipPermalinkModal clipId={clipId} gameId={gameId} />
}
