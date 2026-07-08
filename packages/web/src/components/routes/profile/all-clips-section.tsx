import type { UserClip } from "@alloy/api"
import { t } from "@alloy/i18n"
import { PageToolbar } from "@alloy/ui/components/page-toolbar"
import { useMemo } from "react"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
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
    title: t("Couldn't load clips"),
    toastId: "profile-all-clips-error",
  })
  const gameOptions = useMemo(() => {
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

  const selectedGame = useMemo(() => {
    if (!gameSlug) return null
    return gameOptions.find((g) => g.slug === gameSlug) ?? null
  }, [gameOptions, gameSlug])
  const selectedGameName = selectedGame?.name ?? null

  const visible = useMemo(() => {
    if (!clips) return null
    const byGame = gameSlug
      ? clips.filter((c) => c.gameRef?.slug === gameSlug)
      : clips
    return sortClips(byGame, sort)
  }, [clips, gameSlug, sort])

  return (
    <section>
      <PageToolbar rail={false}>
        <ClipsFilterBar
          username={username}
          sort={sort}
          gameSlug={gameSlug}
          gameOptions={gameOptions}
        />
      </PageToolbar>
      <ClipSectionContent
        rows={visible}
        error={error}
        errorSeed="profile-all-error"
        errorTitle={t("Couldn't load clips")}
        emptySeed={`profile-all-empty-${gameSlug ?? "none"}`}
        emptyTitle={
          gameSlug
            ? t("No clips for {game} yet", {
                game: selectedGameName ?? t("this game"),
              })
            : t("No clips uploaded yet")
        }
        emptyHint={
          gameSlug
            ? t("Try a different game or clear the filter.")
            : t("Clips from this user will show up here once they upload.")
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
