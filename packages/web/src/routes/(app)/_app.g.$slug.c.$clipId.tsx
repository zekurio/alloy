import { createFileRoute, redirect } from "@tanstack/react-router"

import { api } from "@/lib/api"
import { parseClipRouteSearch } from "@/lib/clip-route-search"

export const Route = createFileRoute("/(app)/_app/g/$slug/c/$clipId")({
  validateSearch: parseClipRouteSearch,
  loader: async ({ location, params }) => {
    const game = await api.games.fetchBySlug(params.slug)
    throw redirect({
      to: "/games/$gameId/c/$clipId",
      params: {
        gameId: game.slug,
        clipId: params.clipId,
      },
      search: location.search,
      replace: true,
    })
  },
  component: () => null,
})
