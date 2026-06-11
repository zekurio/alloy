import type { UserClip } from "alloy-api"
import { SectionHead, SectionTitle } from "alloy-ui/components/section-head"
import { Spinner } from "alloy-ui/components/spinner"
import { AwardIcon } from "lucide-react"
import * as React from "react"

import {
  type ClipListEntry,
  ClipListProvider,
} from "@/components/clip/clip-list-context"
import { TopClipsRow } from "@/components/clip/top-clips-row"
import { EmptyState } from "@/components/feedback/empty-state"

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
    <section className="min-w-0">
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
        clips={clips}
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
