import type { UserClip } from "@workspace/api"
import {
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { Spinner } from "@workspace/ui/components/spinner"
import { AwardIcon } from "lucide-react"
import * as React from "react"

import {
  type ClipListEntry,
  ClipListProvider,
} from "@/components/clip/clip-list-context"
import { TopClipsRow } from "@/components/clip/top-clips-row"
import { EmptyState } from "@/components/feedback/empty-state"
import { dateTime } from "@/lib/date-format"

type ProfileTopClipsSectionProps = {
  username: string
  clips: UserClip[] | null
  error: unknown
  isSelf: boolean
}

const TOP_LIMIT = 5

function rankScore(clip: UserClip, now: number): number {
  const createdAt = dateTime(clip.createdAt) ?? now
  const ageDays = Math.max(0, (now - createdAt) / 86_400_000)
  return (clip.viewCount + clip.likeCount * 3) / Math.pow(ageDays + 2, 1.5)
}

export function ProfileTopClipsSection({
  username,
  clips,
  error,
  isSelf,
}: ProfileTopClipsSectionProps) {
  const topClips = React.useMemo<UserClip[] | null>(() => {
    if (clips === null) return null
    const now = Date.now()
    return [...clips]
      .sort((a, b) => rankScore(b, now) - rankScore(a, now))
      .slice(0, TOP_LIMIT)
  }, [clips])

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <AwardIcon className="text-accent" />
            Top clips
          </SectionTitle>
        </div>
      </SectionHead>

      <ProfileTopClipsBody
        username={username}
        clips={topClips}
        error={error}
        isSelf={isSelf}
      />
    </section>
  )
}

type ProfileTopClipsBodyProps = {
  username: string
  clips: UserClip[] | null
  error: unknown
  isSelf: boolean
}

function ProfileTopClipsBody({
  username,
  clips,
  error,
  isSelf,
}: ProfileTopClipsBodyProps) {
  const entries = React.useMemo<ClipListEntry[]>(
    () =>
      (clips ?? []).map((row) => ({
        id: row.id,
        gameSlug: row.gameRef?.slug ?? null,
        row,
      })),
    [clips],
  )

  if (clips === null && error) {
    return (
      <EmptyState
        seed={`profile-${username}-top-error`}
        size="md"
        title="Couldn't load top clips"
      />
    )
  }

  if (clips === null) {
    return <TopClipsSkeletons />
  }

  if (clips.length === 0) {
    return (
      <EmptyState
        seed={`profile-${username}-top-empty`}
        size="md"
        title="No top clips yet"
        hint="Once clips have likes and views, the best ones land here."
      />
    )
  }

  return (
    <ClipListProvider listKey={`profile:${username}:top`} entries={entries}>
      <TopClipsRows clips={clips} isSelf={isSelf} />
    </ClipListProvider>
  )
}

function TopClipsRows({
  clips,
  isSelf,
}: {
  clips: readonly UserClip[]
  isSelf: boolean
}) {
  return <TopClipsRow items={clips.map((row) => ({ row, owned: isSelf }))} />
}

function TopClipsSkeletons() {
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner className="size-6" />
    </div>
  )
}
