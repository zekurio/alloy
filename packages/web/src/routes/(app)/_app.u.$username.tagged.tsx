import { t as tx } from "@alloy/i18n"
import {
  SectionActions,
  SectionHead,
  SectionMeta,
} from "@alloy/ui/components/section-head"
import { createFileRoute } from "@tanstack/react-router"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import { headerCountLabel } from "@/lib/number-format"
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
    title: tx("Couldn't load tagged clips"),
    toastId: "profile-tagged-error",
  })

  return (
    <section>
      {clips ? (
        <SectionHead className="justify-end">
          <SectionActions>
            <SectionMeta>{headerCountLabel(clips.length, "clip")}</SectionMeta>
          </SectionActions>
        </SectionHead>
      ) : null}

      <ClipSectionContent
        rows={clips}
        error={error}
        errorSeed="profile-tagged-error"
        errorTitle={tx("Couldn't load tagged clips")}
        emptySeed="profile-tagged-empty"
        emptyTitle={tx("No tagged clips yet")}
        emptyHint={tx("Clips where this user is tagged will show up here.")}
        listKey={`profile:${username}:tagged`}
        isOwnedByViewer={() => isSelf}
      />
    </section>
  )
}
