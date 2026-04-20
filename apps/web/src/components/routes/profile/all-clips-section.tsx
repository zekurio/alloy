import * as React from "react"
import { FilmIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { ClipCardTrigger } from "../../../components/clip-player-dialog"
import { ClipGrid } from "../../../components/clip-grid"
import { EmptyState } from "../../../components/empty-state"
import { toClipCardData } from "../../../lib/clip-format"
import { useQueryErrorToast } from "../../../lib/use-query-error-toast"
import type { UserClip } from "../../../lib/users-api"
import type { ProfileAllSort } from "../../../routes/_app.u.$username.all"
import { ClipsFilterBar } from "./clips-filter-bar"

/**
 * The full-grid "All clips" view for `/u/$username/all`. Owns the filter
 * bar and applies the active sort + game filter to the clip list (both read
 * from search params on the route — this component is pure render).
 *
 * Filtering/sorting happens client-side over the list we already fetched
 * via `useUserClipsQuery`. No backend changes needed for the MVP; if the
 * list ever grows past "fits in memory" we'd push sort/game down to the
 * server endpoint.
 */
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
  // Derive the set of games present in this user's clips — powers the
  // game-filter dropdown. We only surface games with a resolved `gameRef`
  // (slug is mandatory for URL filtering); legacy free-form `game` strings
  // without a SteamGridDB match fall through to "All games".
  const gameOptions = React.useMemo(() => {
    if (!clips) return []
    const map = new Map<string, { slug: string; name: string; count: number }>()
    for (const clip of clips) {
      const ref = clip.gameRef
      if (!ref) continue
      const existing = map.get(ref.slug)
      if (existing) existing.count += 1
      else map.set(ref.slug, { slug: ref.slug, name: ref.name, count: 1 })
    }
    // Alphabetised — the same game won't jump positions as counts change.
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [clips])

  const selectedGameName = React.useMemo(() => {
    if (!gameSlug) return null
    return gameOptions.find((g) => g.slug === gameSlug)?.name ?? null
  }, [gameOptions, gameSlug])

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
            <span className="font-mono text-2xs text-foreground-faint">
              {visible.length} {visible.length === 1 ? "clip" : "clips"}
            </span>
          ) : null}
        </SectionActions>
      </SectionHead>

      <ClipsFilterBar
        username={username}
        sort={sort}
        gameSlug={gameSlug}
        selectedGameName={selectedGameName}
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
        <ClipGrid>
          {visible.map((row) => {
            const card = toClipCardData(row)
            return (
              <ClipCardTrigger
                key={row.id}
                clipId={card.clipId}
                streamUrl={card.streamUrl}
                thumbnail={card.thumbnail}
                variants={card.variants}
                authorHandle={card.author}
                authorId={card.authorId}
                author={card.author}
                authorImage={card.authorImage}
                title={card.title}
                game={card.game}
                gameRef={card.gameRef}
                gameHref={card.gameRef ? `/g/${card.gameRef.slug}` : null}
                views={card.views}
                likes={card.likes}
                comments={card.comments}
                postedAt={card.postedAt}
                accentHue={card.accentHue}
                privacy={isSelf ? card.privacy : undefined}
                clipPrivacy={card.privacy}
                description={card.description}
              />
            )
          })}
        </ClipGrid>
      )}
    </section>
  )
}

function sortClips(clips: UserClip[], sort: ProfileAllSort): UserClip[] {
  // Clone before sorting — React Query shares the query array by reference
  // across subscribers, so an in-place sort would mutate cached data and
  // silently reorder siblings rendered elsewhere (the feed tab reads the
  // same key).
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
