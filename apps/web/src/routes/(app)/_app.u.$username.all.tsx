import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { AllClipsSection } from "@/components/routes/profile/all-clips-section"
import { useUserClipsQuery } from "@/lib/clip-queries"
import { useUserProfileQuery } from "@/lib/user-queries"

const SORT_KEYS = ["recent", "oldest", "top", "views"] as const
export type ProfileAllSort = (typeof SORT_KEYS)[number]

const searchSchema = z.object({
  sort: z.enum(SORT_KEYS).optional(),
  game: z.string().min(1).optional(),
})

export const Route = createFileRoute("/(app)/_app/u/$username/all")({
  validateSearch: searchSchema,
  component: ProfileAllTab,
})

function ProfileAllTab() {
  const { username } = Route.useParams()
  const search = Route.useSearch()
  const clipsQuery = useUserClipsQuery(username)
  const profileQuery = useUserProfileQuery(username)
  const clips = clipsQuery.data ?? null
  const clipsError = clipsQuery.error ?? null
  const isSelf = profileQuery.data?.viewer?.isSelf ?? false

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
