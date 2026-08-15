import { t } from "@alloy/i18n"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense, lazy } from "react"

import { useUserClipsQuery } from "@/lib/clip-queries"
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

export const Route = createFileRoute("/(app)/_app/u/$username/all")({
  validateSearch: parseProfileClipSearch,
  loader: () => {
    void loadProfileClipsSection()
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

  const sort: ProfileClipSort = search.sort ?? "recent"
  const gameSlug = search.game ?? null

  return (
    <Suspense fallback={null}>
      <ProfileClipsSection
        username={username}
        tab="all"
        clips={clips}
        error={clipsError}
        errorTitle={t("Couldn't load clips")}
        emptySeed="profile-all-empty"
        emptyTitle={t("No clips uploaded yet")}
        emptyHint={t(
          "Clips from this user will show up here once they upload.",
        )}
        isSelf={isSelf}
        sort={sort}
        gameSlug={gameSlug}
      />
    </Suspense>
  )
}
