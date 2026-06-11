import { createFileRoute } from "@tanstack/react-router"

import { ProfileClips } from "@/components/routes/profile/profile-clips"
import { ProfileTopClipsSection } from "@/components/routes/profile/profile-top-clips-section"
import { useUserClipsQuery, useUserTopClipsQuery } from "@/lib/clip-queries"
import { useUserProfileViewerQuery } from "@/lib/user-queries"

export const Route = createFileRoute("/(app)/_app/u/$username/feed")({
  component: ProfileFeedTab,
})

function ProfileFeedTab() {
  const { username } = Route.useParams()
  const clipsQuery = useUserClipsQuery(username)
  const topClipsQuery = useUserTopClipsQuery(username)
  const viewerQuery = useUserProfileViewerQuery(username)
  const clips = clipsQuery.data ?? null
  const clipsError = clipsQuery.error ?? null
  const topClips = topClipsQuery.data ?? null
  const topClipsError = topClipsQuery.error ?? null
  const isSelf = viewerQuery.data?.viewer?.isSelf ?? false

  return (
    <div className="flex flex-col gap-8">
      <ProfileTopClipsSection
        username={username}
        clips={topClips}
        error={topClipsError}
        isSelf={isSelf}
      />
      <ProfileClips
        username={username}
        clips={clips}
        error={clipsError}
        isSelf={isSelf}
      />
    </div>
  )
}
