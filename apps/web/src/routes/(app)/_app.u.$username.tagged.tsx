import { createFileRoute } from "@tanstack/react-router"
import { TagIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { ClipCardList } from "../../components/clip-card-list"
import { ClipGrid } from "../../components/clip-grid"
import { EmptyState } from "../../components/empty-state"
import { useTaggedClipsQuery, useUserProfileQuery } from "../../lib/user-queries"
import { useQueryErrorToast } from "../../lib/use-query-error-toast"

export const Route = createFileRoute("/(app)/_app/u/$username/tagged")({
  component: ProfileTaggedTab,
})

function ProfileTaggedTab() {
  const { username } = Route.useParams()
  const clipsQuery = useTaggedClipsQuery(username)
  const profileQuery = useUserProfileQuery(username)
  const clips = clipsQuery.data ?? null
  const error = clipsQuery.error ?? null
  const isSelf = profileQuery.data?.viewer?.isSelf ?? false

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
            <span className="text-xs text-foreground-faint tabular-nums">
              {clips.length} {clips.length === 1 ? "clip" : "clips"}
            </span>
          ) : null}
        </SectionActions>
      </SectionHead>

      {error ? (
        <EmptyState
          seed="profile-tagged-error"
          size="md"
          title="Couldn't load tagged clips"
        />
      ) : clips === null ? (
        <ClipGrid>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-md" />
          ))}
        </ClipGrid>
      ) : clips.length === 0 ? (
        <EmptyState
          seed="profile-tagged-empty"
          size="lg"
          title="No tagged clips yet"
          hint="Clips where this user is tagged will show up here."
        />
      ) : (
        <ClipCardList rows={clips} isOwnedByViewer={() => isSelf} />
      )}
    </section>
  )
}
