import { t } from "@alloy/i18n"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense, lazy } from "react"

import {
  parseProfileClipSearch,
  type ProfileClipSort,
} from "@/lib/profile-all-search"
import {
  useTaggedClipsQuery,
  useUserProfileViewerQuery,
} from "@/lib/user-queries"

const loadProfileClipsSection = async () => {
  const module =
    await import("@/components/routes/profile/profile-clips-section")
  return { default: module.ProfileClipsSection }
}

const ProfileClipsSection = lazy(loadProfileClipsSection)

export const Route = createFileRoute("/(app)/_app/u/$username/tagged")({
  validateSearch: parseProfileClipSearch,
  loader: () => {
    void loadProfileClipsSection()
  },
  component: ProfileTaggedTab,
})

function ProfileTaggedTab() {
  const { username } = Route.useParams()
  const search = Route.useSearch()
  const clipsQuery = useTaggedClipsQuery(username)
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
        tab="tagged"
        clips={clips}
        error={error}
        errorTitle={t("Couldn't load tagged clips")}
        emptySeed="profile-tagged-empty"
        emptyTitle={t("No tagged clips yet")}
        emptyHint={t("Clips where this user is tagged will show up here.")}
        isSelf={isSelf}
        sort={sort}
        gameSlug={gameSlug}
      />
    </Suspense>
  )
}
