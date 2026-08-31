import type { UserClip } from "@alloy/api"
import { t } from "@alloy/i18n"
import { PageToolbar } from "@alloy/ui/components/page-toolbar"
import { useMemo } from "react"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import { compareDateAsc, compareDateDesc } from "@/lib/date-format"
import type { ProfileClipSort } from "@/lib/profile-all-search"

import { ClipsFilterBar, type ProfileClipTab } from "./clips-filter-bar"

type ProfileClipsSectionProps = {
  username: string
  tab: ProfileClipTab
  clips: UserClip[] | null
  error: Error | null
  errorTitle: string
  emptyTitle: string
  emptyHint: string
  emptySeed: string
  isSelf: boolean
  sort: ProfileClipSort
  gameSlug: string | null
}

export function ProfileClipsSection({
  username,
  tab,
  clips,
  error,
  errorTitle,
  emptyTitle,
  emptyHint,
  emptySeed,
  isSelf,
  sort,
  gameSlug,
}: ProfileClipsSectionProps) {
  const gameOptions = useMemo(() => {
    if (!clips) return []
    const map = new Map<
      string,
      {
        slug: string
        name: string
        iconUrl: string | null
        logoUrl: string | null
      }
    >()
    for (const clip of clips) {
      const ref = clip.gameRef
      if (!ref) continue
      if (map.has(ref.slug)) continue
      map.set(ref.slug, {
        slug: ref.slug,
        name: ref.name,
        iconUrl: ref.iconUrl,
        logoUrl: ref.logoUrl,
      })
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [clips])

  const selectedGame = useMemo(() => {
    if (!gameSlug) return null
    return gameOptions.find((game) => game.slug === gameSlug) ?? null
  }, [gameOptions, gameSlug])

  const visible = useMemo(() => {
    if (!clips) return null
    const byGame = gameSlug
      ? clips.filter((clip) => clip.gameRef?.slug === gameSlug)
      : clips
    return sortClips(byGame, sort)
  }, [clips, gameSlug, sort])

  const showToolbar = clips !== null && clips.length > 0

  return (
    <section>
      {showToolbar ? (
        <PageToolbar rail={false} className="-mt-4 sm:-mt-6">
          <ClipsFilterBar
            username={username}
            tab={tab}
            sort={sort}
            gameSlug={gameSlug}
            gameOptions={gameOptions}
          />
        </PageToolbar>
      ) : null}
      <ClipSectionContent
        rows={visible}
        error={error}
        errorTitle={errorTitle}
        emptySeed={`${emptySeed}-${gameSlug ?? "none"}`}
        emptyTitle={
          gameSlug
            ? t("No clips for {game} yet", {
                game: selectedGame?.name ?? t("this game"),
              })
            : emptyTitle
        }
        emptyHint={
          gameSlug ? t("Try a different game or clear the filter.") : emptyHint
        }
        listKey={`profile:${username}:${tab}:${sort}:${gameSlug ?? ""}`}
        isOwnedByViewer={() => isSelf}
      />
    </section>
  )
}

function sortClips(clips: UserClip[], sort: ProfileClipSort): UserClip[] {
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
