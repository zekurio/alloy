import { createFileRoute } from "@tanstack/react-router"
import { Suspense, lazy } from "react"

import { useUserClipsQuery } from "@/lib/clip-queries"
import {
  parseProfileAllSearch,
  type ProfileAllSort,
} from "@/lib/profile-all-search"
import { useUserProfileViewerQuery } from "@/lib/user-queries"

const loadAllClipsSection = async () => {
  const module = await import("@/components/routes/profile/all-clips-section")
  return { default: module.AllClipsSection }
}

const AllClipsSection = lazy(loadAllClipsSection)

export const Route = createFileRoute("/(app)/_app/u/$username/all")({
  validateSearch: parseProfileAllSearch,
  loader: () => {
    void loadAllClipsSection()
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
    <Suspense fallback={null}>
      <AllClipsSection
        username={username}
        clips={clips}
        error={clipsError}
        isSelf={isSelf}
        sort={sort}
        gameSlug={gameSlug}
      />
    </Suspense>
  )
}
