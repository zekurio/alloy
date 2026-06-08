import { createFileRoute } from "@tanstack/react-router"
import * as React from "react"

import { AllClipsSection } from "@/components/routes/profile/all-clips-section"
import { useUserClipsQuery } from "@/lib/clip-queries"
import {
  parseProfileAllSearch,
  type ProfileAllSort,
} from "@/lib/profile-all-search"
import { useUserProfileViewerQuery } from "@/lib/user-queries"

export const Route = createFileRoute("/(app)/_app/u/$username/all")({
  validateSearch: parseProfileAllSearch,
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
