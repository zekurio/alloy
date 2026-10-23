import { createFileRoute } from "@tanstack/react-router"

import { ClipPermalinkModal } from "@/components/app/clip-permalink-modal"
import { ensureClipForPermalink } from "@/lib/clip-navigation"

/**
 * Game-agnostic clip permalink: the canonical URL for clips without a game.
 * Clips with a game keep their game-scoped pretty URL; both render the same
 * viewer dialog over the home feed.
 */
export const Route = createFileRoute("/(app)/_app/clips/$clipId")({
  loader: ({ context, params }) =>
    ensureClipForPermalink(context.queryClient, params.clipId, null),
  component: ClipModalRoute,
})

function ClipModalRoute() {
  const { clipId } = Route.useParams()
  return <ClipPermalinkModal clipId={clipId} gameId={null} />
}
