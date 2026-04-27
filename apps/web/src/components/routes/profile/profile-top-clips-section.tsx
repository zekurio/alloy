import * as React from "react"
import { FlameIcon } from "lucide-react"

import { CarouselItem } from "@workspace/ui/components/carousel"
import {
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { Spinner } from "@workspace/ui/components/spinner"

import { ClipCardTrigger } from "@/components/clip/clip-card-trigger"
import { ClipGrid } from "@/components/clip/clip-grid"
import {
  ClipListProvider,
  type ClipListEntry,
} from "@/components/clip/clip-list-context"
import { TopClipsCarousel } from "@/components/clip/top-clips-carousel"
import { EmptyState } from "@/components/feedback/empty-state"
import type { UserClip } from "@workspace/api"

type ProfileTopClipsSectionProps = {
  username: string
  clips: UserClip[] | null
  isSelf: boolean
}

const TOP_LIMIT = 5

function rankScore(clip: UserClip, now: number): number {
  const ageDays = Math.max(
    0,
    (now - new Date(clip.createdAt).getTime()) / 86_400_000
  )
  return (clip.viewCount + clip.likeCount * 3) / Math.pow(ageDays + 2, 1.5)
}

export function ProfileTopClipsSection({
  username,
  clips,
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
            <FlameIcon className="text-accent" />
            Top clips
          </SectionTitle>
        </div>
      </SectionHead>

      <ProfileTopClipsBody
        username={username}
        clips={topClips}
        isSelf={isSelf}
      />
    </section>
  )
}

type ProfileTopClipsBodyProps = {
  username: string
  clips: UserClip[] | null
  isSelf: boolean
}

function ProfileTopClipsBody({
  username,
  clips,
  isSelf,
}: ProfileTopClipsBodyProps) {
  const entries = React.useMemo<ClipListEntry[]>(
    () =>
      (clips ?? []).map((row) => ({
        id: row.id,
        gameSlug: row.gameRef?.slug ?? null,
        row,
      })),
    [clips]
  )

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
  return (
    <>
      <div className="xl:hidden">
        <TopClipsCarousel>
          {clips.map((row) => (
            <CarouselItem
              key={row.id}
              className="basis-full pl-3 md:basis-1/3 md:pl-4"
            >
              <ClipCardTrigger
                row={row}
                owned={isSelf}
                className="mx-auto w-full max-w-3xl md:max-w-none"
              />
            </CarouselItem>
          ))}
        </TopClipsCarousel>
      </div>
      <div className="hidden xl:block">
        <ClipGrid>
          {clips.map((row) => (
            <ClipCardTrigger key={row.id} row={row} owned={isSelf} />
          ))}
        </ClipGrid>
      </div>
    </>
  )
}

function TopClipsSkeletons() {
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner className="size-6" />
    </div>
  )
}
