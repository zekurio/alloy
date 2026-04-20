import { createFileRoute } from "@tanstack/react-router"

import { ClipsSection } from "../components/routes/profile/clips-section"
import { GamesSection } from "../components/routes/profile/games-section"
import { useUserClipsQuery } from "../lib/clip-queries"
import { useUserProfileQuery } from "../lib/user-queries"

/**
 * `/u/$username/feed` — default profile tab. Mirrors the previous "home"
 * tab: the recently-played games carousel (clickable → `/all?game=<slug>`)
 * and the recent clips grid.
 */
export const Route = createFileRoute("/_app/u/$username/feed")({
  component: ProfileFeedTab,
})

function ProfileFeedTab() {
  const { username } = Route.useParams()
  const clipsQuery = useUserClipsQuery(username)
  const profileQuery = useUserProfileQuery(username)
  const clips = clipsQuery.data ?? null
  const clipsError = clipsQuery.error ?? null
  const isSelf = profileQuery.data?.viewer?.isSelf ?? false

  return (
    <>
      <GamesSection clips={clips} username={username} />
      <ClipsSection
        clips={clips}
        error={clipsError}
        variant="recent"
        isSelf={isSelf}
      />
    </>
  )
}
