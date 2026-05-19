import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"

import { AllClipsSection } from "@/components/routes/profile/all-clips-section"
import { useUserClipsQuery } from "@/lib/clip-queries"
import { useUserProfileViewerQuery } from "@/lib/user-queries"

const SORT_KEYS = ["recent", "oldest", "top", "views"] as const
export type ProfileAllSort = (typeof SORT_KEYS)[number]

const sortKeys = new Set<string>(SORT_KEYS)

type ProfileAllSearch = {
  sort?: ProfileAllSort
  game?: string
}

export const Route = createFileRoute("/(app)/_app/u/$username/all")({
  validateSearch: (search: Record<string, unknown>): ProfileAllSearch => {
    const sort = search.sort
    const game = search.game
    return {
      ...(typeof sort === "string" && sortKeys.has(sort)
        ? { sort: sort as ProfileAllSort }
        : {}),
      ...(typeof game === "string" && game.length > 0 ? { game } : {}),
    }
  },
  component: ProfileAllTab,
})

function ProfileAllTab() {
  const { username } = Route.useParams()
  const search = Route.useSearch()
  const clipsQuery = useUserClipsQuery(username)
  const viewerQuery = useUserProfileViewerQuery(username)
  const clips = clipsQuery.data ?? null
  const clipsError = clipsQuery.error ?? null
  const isSelf = viewerQuery.data?.viewer?.isSelf ?? false

  const sort: ProfileAllSort = search.sort ?? "recent"
  const gameSlug = search.game ?? null

  return (
    <React.Suspense fallback={null}>
      <AllClipsSection
        username={username}
        clips={clips}
        error={clipsError}
        isSelf={isSelf}
        sort={sort}
        gameSlug={gameSlug}
      />
    </React.Suspense>
  )
}
