import type { UserClip } from "@workspace/api"
import {
  SectionActions,
  SectionHead,
  SectionMeta,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { FilmIcon } from "lucide-react"
import * as React from "react"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import { compareDateAsc, compareDateDesc } from "@/lib/date-format"
import { headerCountLabel } from "@/lib/number-format"
import type { ProfileAllSort } from "@/lib/profile-all-search"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

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
      else {
        map.set(ref.slug, {
          slug: ref.slug,
          name: ref.name,
          count: 1,
          iconUrl: ref.iconUrl,
          logoUrl: ref.logoUrl,
        })
      }
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
              {headerCountLabel(visible.length, "clip")}
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

      <ClipSectionContent
        rows={visible}
        error={error}
        errorSeed="profile-all-error"
        errorTitle="Couldn't load clips"
        emptySeed={`profile-all-empty-${gameSlug ?? "none"}`}
        emptyTitle={
          gameSlug
            ? `No clips for ${selectedGameName ?? "this game"} yet`
            : "No clips uploaded yet"
        }
        emptyHint={
          gameSlug
            ? "Try a different game or clear the filter."
            : "Clips from this user will show up here once they upload."
        }
        listKey={`profile:${username}:all:${sort}:${gameSlug ?? ""}`}
        isOwnedByViewer={() => isSelf}
      />
    </section>
  )
}

function sortClips(clips: UserClip[], sort: ProfileAllSort): UserClip[] {
  const copy = clips.slice()
  switch (sort) {
    case "recent":
      copy.sort((a, b) => compareDateDesc(a.createdAt, b.createdAt))
      break
    case "oldest":
      copy.sort((a, b) => compareDateAsc(a.createdAt, b.createdAt))
      break
    case "top":
      copy.sort(
        (a, b) =>
          b.likeCount - a.likeCount ||
          compareDateDesc(a.createdAt, b.createdAt),
      )
      break
    case "views":
      copy.sort(
        (a, b) =>
          b.viewCount - a.viewCount ||
          compareDateDesc(a.createdAt, b.createdAt),
      )
      break
  }
  return copy
}
