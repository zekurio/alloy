import { t } from "@alloy/i18n"
import { useInfiniteQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo } from "react"

import { ProfileClipsSection } from "@/components/routes/profile/profile-clips-section"
import {
  flattenUserClipPages,
  profileMediaQueryOptions,
} from "@/lib/clip-queries"
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
  const sort = search.sort ?? "recent"
  // Screenshots across every game, which keep the game filter's options listed
  // while one game is selected. Without a game filter this is the same query
  // the section shows.
  const screenshotsQuery = useInfiniteQuery(
    profileMediaQueryOptions(username, { tab: "all", media: "image", sort }),
  )
  const screenshots = useMemo(
    () =>
      screenshotsQuery.data
        ? flattenUserClipPages(screenshotsQuery.data.pages)
        : null,
    [screenshotsQuery.data],
  )
  return (
    <ProfileClipsSection
      username={username}
      tab="screenshots"
      clips={screenshots}
      error={screenshotsQuery.error}
      errorTitle={t("Couldn't load screenshots")}
      emptyTitle={t("No screenshots yet")}
      emptyHint={t("Be the first to post one.")}
      emptySeed="profile-screenshots-empty"
      isSelf={viewer.data?.viewer?.isSelf ?? false}
      sort={sort}
      gameSlug={search.game ?? null}
    />
  )
}
