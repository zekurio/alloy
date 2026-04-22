import * as React from "react"
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
import type { ProfileAllSort } from "@/routes/(app)/_app.u.$username.all"
import { ClipsFilterBar } from "./clips-filter-bar"

type AllClipsSectionProps = {
  username: string
  clips: UserClip[] | null
  error: Error | null
  isSelf: boolean
  sort: ProfileAllSort
  gameSlug: string | null
}

export function AllClipsSection({
  username,
  clips,
  error,
  isSelf,
  sort,
  gameSlug,
}: AllClipsSectionProps) {
  useQueryErrorToast(error, {
    title: "Couldn't load clips",
    toastId: "profile-all-clips-error",
  })
  const gameOptions = React.useMemo(() => {
    if (!clips) return []
    const map = new Map<
      string,
      {
        slug: string
        name: string
        count: number
        iconUrl: string | null
        logoUrl: string | null
      }
    >()
    for (const clip of clips) {
      const ref = clip.gameRef
      if (!ref) continue
      const existing = map.get(ref.slug)
      if (existing) existing.count += 1
      else
        map.set(ref.slug, {
          slug: ref.slug,
          name: ref.name,
          count: 1,
          iconUrl: ref.iconUrl,
          logoUrl: ref.logoUrl,
        })
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [clips])

  const selectedGame = React.useMemo(() => {
    if (!gameSlug) return null
    return gameOptions.find((g) => g.slug === gameSlug) ?? null
  }, [gameOptions, gameSlug])
  const selectedGameName = selectedGame?.name ?? null

  const visible = React.useMemo(() => {
    if (!clips) return null
    const byGame = gameSlug
      ? clips.filter((c) => c.gameRef?.slug === gameSlug)
      : clips
    return sortClips(byGame, sort)
  }, [clips, gameSlug, sort])

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <FilmIcon className="text-accent" />
            All clips
          </SectionTitle>
        </div>
        <SectionActions>
          {visible ? (
            <SectionMeta>
              {visible.length} {visible.length === 1 ? "clip" : "clips"}
            </SectionMeta>
          ) : null}
        </SectionActions>
      </SectionHead>

      <ClipsFilterBar
        username={username}
        sort={sort}
        gameSlug={gameSlug}
        selectedGame={selectedGame}
        gameOptions={gameOptions}
      />

      {error ? (
        <EmptyState
          seed="profile-all-error"
          size="md"
          title="Couldn't load clips"
        />
      ) : visible === null ? (
        <ClipGrid>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-md" />
          ))}
        </ClipGrid>
      ) : visible.length === 0 ? (
        <EmptyState
          seed={`profile-all-empty-${gameSlug ?? "none"}`}
          size="lg"
          title={
            gameSlug
              ? `No clips for ${selectedGameName ?? "this game"} yet`
              : "No clips uploaded yet"
          }
          hint={
            gameSlug
              ? "Try a different game or clear the filter."
              : "Clips from this user will show up here once they upload."
          }
        />
      ) : (
        <ClipCardList
          rows={visible}
          isOwnedByViewer={() => isSelf}
          listKey={`profile:${username}:all:${sort}:${gameSlug ?? ""}`}
        />
      )}
    </section>
  )
}

function sortClips(clips: UserClip[], sort: ProfileAllSort): UserClip[] {
  const copy = clips.slice()
  switch (sort) {
    case "recent":
      copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      break
    case "oldest":
      copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      break
    case "top":
      copy.sort(
        (a, b) =>
          b.likeCount - a.likeCount || b.createdAt.localeCompare(a.createdAt)
      )
      break
    case "views":
      copy.sort(
        (a, b) =>
          b.viewCount - a.viewCount || b.createdAt.localeCompare(a.createdAt)
      )
      break
  }
  return copy
}
