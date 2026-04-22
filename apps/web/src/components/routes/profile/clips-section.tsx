import { FilmIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionMeta,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { ClipCardList } from "@/components/clip/clip-card-list"
import { ClipGrid } from "@/components/clip/clip-grid"
import { EmptyState } from "@/components/feedback/empty-state"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"
import type { UserClip } from "@/lib/users-api"

type ClipsSectionProps = {
  username: string
  clips: UserClip[] | null
  error: Error | null
  variant: "recent" | "all"
  isSelf: boolean
}

export function ClipsSection({
  username,
  clips,
  error,
  variant,
  isSelf,
}: ClipsSectionProps) {
  useQueryErrorToast(error, {
    title: "Couldn't load clips",
    toastId: `profile-${variant}-clips-error`,
  })
  const visibleClips =
    variant === "recent" && clips ? clips.slice(0, 12) : clips

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <FilmIcon className="text-accent" />
            {variant === "recent" ? "Recent clips" : "All clips"}
          </SectionTitle>
        </div>
        <SectionActions>
          {visibleClips ? (
            <SectionMeta>
              {visibleClips.length}{" "}
              {visibleClips.length === 1 ? "clip" : "clips"}
            </SectionMeta>
          ) : null}
        </SectionActions>
      </SectionHead>

      {error ? (
        <EmptyState
          seed={`profile-${variant}-error`}
          size="md"
          title="Couldn't load clips"
        />
      ) : clips === null ? (
        <ClipGrid>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-md" />
          ))}
        </ClipGrid>
      ) : !visibleClips || visibleClips.length === 0 ? (
        <EmptyState
          seed={`profile-${variant}-empty`}
          size="lg"
          title="No clips uploaded yet"
          hint="Clips from this user will show up here once they upload."
        />
      ) : (
        <ClipCardList
          rows={visibleClips}
          isOwnedByViewer={() => isSelf}
          listKey={`profile:${username}:${variant}`}
        />
      )}
    </section>
  )
}
