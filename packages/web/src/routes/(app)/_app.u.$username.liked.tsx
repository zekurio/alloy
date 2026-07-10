import { t } from "@alloy/i18n"
import { createFileRoute } from "@tanstack/react-router"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import { useUserLikedClipsQuery } from "@/lib/clip-queries"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"
import { useUserProfileViewerQuery } from "@/lib/user-queries"

export const Route = createFileRoute("/(app)/_app/u/$username/liked")({
  component: ProfileLikedTab,
})

function ProfileLikedTab() {
  const { username } = Route.useParams()
  const clipsQuery = useUserLikedClipsQuery(username)
  const viewerQuery = useUserProfileViewerQuery(username)
  const clips = clipsQuery.data ?? null
  const error = clipsQuery.error ?? null
  const isSelf = viewerQuery.data?.viewer?.isSelf ?? false

  useQueryErrorToast(error, {
    title: t("Couldn't load liked clips"),
    toastId: "profile-liked-error",
  })

  return (
    <section>
      <ClipSectionContent
        rows={clips}
        error={error}
        errorTitle={t("Couldn't load liked clips")}
        emptySeed="profile-liked-empty"
        emptyTitle={t("No liked clips yet")}
        emptyHint={t("Videos this user likes will show up here.")}
        listKey={`profile:${username}:liked`}
        isOwnedByViewer={() => isSelf}
      />
    </section>
  )
}
