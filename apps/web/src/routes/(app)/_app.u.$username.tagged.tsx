import { createFileRoute } from "@tanstack/react-router"
import { TagIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionMeta,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import {
  useTaggedClipsQuery,
  useUserProfileViewerQuery,
} from "@/lib/user-queries"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

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
            <SectionMeta>
              {clips.length} {clips.length === 1 ? "clip" : "clips"}
            </SectionMeta>
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
