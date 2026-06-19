import type { UserClip } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import * as React from "react"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import { useHeaderToolbar } from "@/components/layout/header-toolbar"
import { createHeaderToolbarControls } from "@/components/layout/header-toolbar-controls"
import { compareDateAsc, compareDateDesc } from "@/lib/date-format"
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
    title: tx("Couldn't load clips"),
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

  const toolbar = React.useMemo(
    () =>
      createHeaderToolbarControls({
        desktop: (
          <ClipsFilterBar
            username={username}
            sort={sort}
            gameSlug={gameSlug}
            gameOptions={gameOptions}
          />
        ),
        mobile: (
          <ClipsFilterBar
            username={username}
            sort={sort}
            gameSlug={gameSlug}
            gameOptions={gameOptions}
            triggerVariant="icon"
          />
        ),
      }),
    [gameOptions, gameSlug, sort, username],
  )
  useHeaderToolbar(toolbar)

  return (
    <section>
      <ClipSectionContent
        rows={visible}
        error={error}
        errorSeed="profile-all-error"
        errorTitle={tx("Couldn't load clips")}
        emptySeed={`profile-all-empty-${gameSlug ?? "none"}`}
        emptyTitle={
          gameSlug
            ? tx("No clips for {game} yet", {
                game: selectedGameName ?? tx("this game"),
              })
            : tx("No clips uploaded yet")
        }
        emptyHint={
          gameSlug
            ? tx("Try a different game or clear the filter.")
            : tx("Clips from this user will show up here once they upload.")
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
