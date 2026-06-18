import type { UserClip } from "@alloy/api"
import { t as tx } from "@alloy/i18n"

import { TopClipsSection } from "@/components/clip/top-clips-section"

type ProfileTopClipsSectionProps = {
  username: string
  clips: UserClip[] | null
  error: unknown
  isSelf: boolean
}

export function ProfileTopClipsSection({
  username,
  clips,
  error,
  isSelf,
}: ProfileTopClipsSectionProps) {
  return (
    <TopClipsSection
      className="min-w-0"
      listKey={`profile:${username}:top`}
      seed={`profile-${username}-top`}
      rows={clips}
      error={error}
      owned={() => isSelf}
      emptyTitle={tx("No top clips yet")}
      emptyHint={tx(
        "Once clips have likes and views, the best ones land here.",
      )}
    />
  )
}
