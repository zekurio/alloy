import { t } from "@alloy/i18n"
import { createFileRoute } from "@tanstack/react-router"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"
import {
  useTaggedClipsQuery,
  useUserProfileViewerQuery,
} from "@/lib/user-queries"

export const Route = createFileRoute("/(app)/_app/u/$username/tagged")({
  component: ProfileTaggedTab,
})

function ProfileTaggedTab() {
  const { username } = Route.useParams()
  const clipsQuery = useTaggedClipsQuery(username)
  const viewerQuery = useUserProfileViewerQuery(username)
  const clips = clipsQuery.data ?? null
  const error = clipsQuery.error ?? null
  const isSelf = viewerQuery.data?.viewer?.isSelf ?? false

  useQueryErrorToast(error, {
    title: t("Couldn't load tagged clips"),
    toastId: "profile-tagged-error",
  })

  return (
    <section>
      <ClipSectionContent
        rows={clips}
        error={error}
        errorTitle={t("Couldn't load tagged clips")}
        emptySeed="profile-tagged-empty"
        emptyTitle={t("No tagged clips yet")}
        emptyHint={t("Clips where this user is tagged will show up here.")}
        listKey={`profile:${username}:tagged`}
        isOwnedByViewer={() => isSelf}
      />
    </section>
  )
}
