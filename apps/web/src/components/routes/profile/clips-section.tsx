import { FilmIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionMeta,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import { formatCount } from "@/lib/number-format"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"
import type { UserClip } from "@workspace/api"

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
              {formatCount(visibleClips.length)}{" "}
              {visibleClips.length === 1 ? "clip" : "clips"}
            </SectionMeta>
          ) : null}
        </SectionActions>
      </SectionHead>

      <ClipSectionContent
        rows={visibleClips}
        error={error}
        errorSeed={`profile-${variant}-error`}
        errorTitle="Couldn't load clips"
        emptySeed={`profile-${variant}-empty`}
        emptyTitle="No clips uploaded yet"
        emptyHint="Clips from this user will show up here once they upload."
        listKey={`profile:${username}:${variant}`}
        isOwnedByViewer={() => isSelf}
      />
    </section>
  )
}
