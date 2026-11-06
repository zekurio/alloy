import { createFileRoute, redirect } from "@tanstack/react-router"

import { clipPermalink, ensureClipForPermalink } from "@/lib/clip-navigation"

/**
 * Legacy game-less clip link. Every clip lives under its game or the
 * uncategorised group now; this only forwards links shared before that.
 */
export const Route = createFileRoute("/(app)/_app/clips/$clipId")({
  loader: async ({ context, params, preload }) => {
    const clip = await ensureClipForPermalink(
      context.queryClient,
      params.clipId,
      null,
      preload,
    )
    throw redirect({
      ...clipPermalink(clip.id, clip.gameRef?.slug ?? null),
      replace: true,
    })
  },
})
