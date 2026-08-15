import { t } from "@alloy/i18n"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense, lazy } from "react"

import { useUserLikedClipsQuery } from "@/lib/clip-queries"
import {
  parseProfileClipSearch,
  type ProfileClipSort,
} from "@/lib/profile-all-search"
import { useUserProfileViewerQuery } from "@/lib/user-queries"

const loadProfileClipsSection = async () => {
  const module =
    await import("@/components/routes/profile/profile-clips-section")
  return { default: module.ProfileClipsSection }
}

const ProfileClipsSection = lazy(loadProfileClipsSection)

export const Route = createFileRoute("/(app)/_app/u/$username/liked")({
  validateSearch: parseProfileClipSearch,
  loader: () => {
    void loadProfileClipsSection()
  },
  component: ProfileLikedTab,
})

function ProfileLikedTab() {
  const { username } = Route.useParams()
  const search = Route.useSearch()
  const clipsQuery = useUserLikedClipsQuery(username)
  const viewerQuery = useUserProfileViewerQuery(username)
  const clips = clipsQuery.data ?? null
  const error = clipsQuery.error ?? null
  const isSelf = viewerQuery.data?.viewer?.isSelf ?? false
  const sort: ProfileClipSort = search.sort ?? "recent"
  const gameSlug = search.game ?? null

  return (
    <Suspense fallback={null}>
      <ProfileClipsSection
        username={username}
        tab="liked"
        clips={clips}
        error={error}
        errorTitle={t("Couldn't load liked clips")}
        emptySeed="profile-liked-empty"
        emptyTitle={t("No liked clips yet")}
        emptyHint={t("Videos this user likes will show up here.")}
        isSelf={isSelf}
        sort={sort}
        gameSlug={gameSlug}
      />
    </Suspense>
  )
}
