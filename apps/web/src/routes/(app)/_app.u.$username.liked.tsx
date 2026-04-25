import { createFileRoute } from "@tanstack/react-router"
import { HeartIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionMeta,
  SectionTitle,
} from "@workspace/ui/components/section-head"

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
    title: "Couldn't load liked clips",
    toastId: "profile-liked-error",
  })

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <HeartIcon className="text-accent" />
            Liked
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
        errorSeed="profile-liked-error"
        errorTitle="Couldn't load liked clips"
        emptySeed="profile-liked-empty"
        emptyTitle="No liked clips yet"
        emptyHint="Videos this user likes will show up here."
        listKey={`profile:${username}:liked`}
        isOwnedByViewer={() => isSelf}
      />
    </section>
  )
}
