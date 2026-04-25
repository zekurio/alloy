import { createFileRoute } from "@tanstack/react-router"

import { ClipsSection } from "@/components/routes/profile/clips-section"
import { GamesSection } from "@/components/routes/profile/games-section"
import { ProfileTopClipsSection } from "@/components/routes/profile/profile-top-clips-section"
import { useUserClipsQuery } from "@/lib/clip-queries"
import { useUserProfileViewerQuery } from "@/lib/user-queries"

export const Route = createFileRoute("/(app)/_app/u/$username/feed")({
  component: ProfileFeedTab,
})

function ProfileFeedTab() {
  const { username } = Route.useParams()
  const clipsQuery = useUserClipsQuery(username)
  const viewerQuery = useUserProfileViewerQuery(username)
  const clips = clipsQuery.data ?? null
  const clipsError = clipsQuery.error ?? null
  const isSelf = viewerQuery.data?.viewer?.isSelf ?? false

  return (
    <div className="flex flex-col gap-6">
      <ProfileTopClipsSection
        username={username}
        clips={clips}
        isSelf={isSelf}
      />
      <GamesSection clips={clips} username={username} />
      <ClipsSection
        username={username}
        clips={clips}
        error={clipsError}
        variant="recent"
        isSelf={isSelf}
      />
    </div>
  )
}
