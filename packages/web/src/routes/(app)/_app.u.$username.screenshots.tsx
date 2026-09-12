import { t } from "@alloy/i18n"
import { createFileRoute } from "@tanstack/react-router"

import { ProfileClipsSection } from "@/components/routes/profile/profile-clips-section"
import { parseProfileClipSearch } from "@/lib/profile-all-search"
import { useUserProfileViewerQuery } from "@/lib/user-queries"

export const Route = createFileRoute("/(app)/_app/u/$username/screenshots")({
  validateSearch: parseProfileClipSearch,
  component: ProfileScreenshotsTab,
})

function ProfileScreenshotsTab() {
  const { username } = Route.useParams()
  const search = Route.useSearch()
  const viewer = useUserProfileViewerQuery(username)
  return (
    <ProfileClipsSection
      username={username}
      tab="screenshots"
      clips={null}
      error={null}
      errorTitle={t("Couldn't load screenshot")}
      emptyTitle={t("No screenshots yet")}
      emptyHint={t("Be the first to post one.")}
      emptySeed="profile-screenshots-empty"
      isSelf={viewer.data?.viewer?.isSelf ?? false}
      sort={search.sort ?? "recent"}
      gameSlug={search.game ?? null}
    />
  )
}
