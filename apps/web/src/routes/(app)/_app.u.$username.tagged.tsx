import { createFileRoute } from "@tanstack/react-router"
import {
  SectionActions,
  SectionHead,
  SectionMeta,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { TagIcon } from "lucide-react"

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
    title: "Couldn't load tagged clips",
    toastId: "profile-tagged-error",
  })

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <TagIcon className="text-accent" />
            Tagged
          </SectionTitle>
        </div>
        <SectionActions>
          {clips ? (
            <SectionMeta>{headerCountLabel(clips.length, "clip")}</SectionMeta>
          ) : null}
        </SectionActions>
      </SectionHead>

      <ClipSectionContent
        rows={clips}
        error={error}
        errorSeed="profile-tagged-error"
        errorTitle="Couldn't load tagged clips"
        emptySeed="profile-tagged-empty"
        emptyTitle="No tagged clips yet"
        emptyHint="Clips where this user is tagged will show up here."
        listKey={`profile:${username}:tagged`}
        isOwnedByViewer={() => isSelf}
      />
    </section>
  )
}
