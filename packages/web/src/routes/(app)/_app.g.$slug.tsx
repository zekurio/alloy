import { createFileRoute, redirect } from "@tanstack/react-router"

import { api } from "@/lib/api"
import { parseGameSearch } from "@/lib/game-search"

export const Route = createFileRoute("/(app)/_app/g/$slug")({
  validateSearch: parseGameSearch,
  loader: async ({ location, params }) => {
    const game = await api.games.fetchBySlug(params.slug)
    throw redirect({
      to: "/games/$gameId",
      params: { gameId: game.slug },
      search: location.search,
      replace: true,
    })
  },
  component: () => null,
})
