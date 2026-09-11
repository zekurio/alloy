import type { UserClip } from "@alloy/api"
import { MEDIA_FILTERS } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { PageToolbar } from "@alloy/ui/components/page-toolbar"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useSearch } from "@tanstack/react-router"
import { useMemo } from "react"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import { profileMediaQueryOptions } from "@/lib/clip-queries"
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
  const search = useSearch({ strict: false })
  const media = MEDIA_FILTERS.find((value) => value === search.media) ?? "all"
  const query = useInfiniteQuery(
    profileMediaQueryOptions(username, {
      tab,
      media,
      sort,
      game: gameSlug ?? undefined,
    }),
  )
  const gameOptions = useMemo(() => {
    if (!clips && !query.data) return []
    const map = new Map<
      string,
      {
        slug: string
        name: string
        iconUrl: string | null
        logoUrl: string | null
      }
    >()
    for (const clip of [
      ...(clips ?? []),
      ...(query.data?.pages.flatMap((page) => page.items) ?? []),
    ]) {
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
  }, [clips, query.data])

  const selectedGame = useMemo(() => {
    if (!gameSlug) return null
    return gameOptions.find((game) => game.slug === gameSlug) ?? null
  }, [gameOptions, gameSlug])

  const visible = query.data
    ? query.data.pages.flatMap((page) => page.items)
    : null

  return (
    <section>
      {
        <PageToolbar rail={false} className="-mt-4 sm:-mt-6">
          <ClipsFilterBar
            username={username}
            tab={tab}
            sort={sort}
            gameSlug={gameSlug}
            gameOptions={gameOptions}
          />
        </PageToolbar>
      }
      <ClipSectionContent
        rows={visible}
        error={query.error ?? (query.data ? null : error)}
        errorTitle={errorTitle}
        emptySeed={`${emptySeed}-${gameSlug ?? "none"}`}
        emptyTitle={
          gameSlug
            ? t("No clips for {game} yet", {
                game: selectedGame?.name ?? t("this game"),
              })
            : media === "image"
              ? t("No screenshots yet")
              : emptyTitle
        }
        emptyHint={
          gameSlug ? t("Try a different game or clear the filter.") : emptyHint
        }
        listKey={`profile:${username}:${tab}:${sort}:${gameSlug ?? ""}:${media}`}
        isOwnedByViewer={() => isSelf}
      />
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          className="mt-6"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage()
          }}
        >
          {query.isFetchingNextPage ? t("Loading…") : t("Load more")}
        </Button>
      ) : null}
    </section>
  )
}
