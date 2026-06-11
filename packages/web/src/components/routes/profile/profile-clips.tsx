import type { UserClip } from "alloy-api"
import { Chip } from "alloy-ui/components/chip"
import { GameIcon } from "alloy-ui/components/game-icon"
import {
  SectionActions,
  SectionHead,
  SectionMeta,
  SectionTitle,
} from "alloy-ui/components/section-head"
import { FilmIcon } from "lucide-react"
import * as React from "react"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import { FilterCarousel } from "@/components/filter-carousel"
import { headerCountLabel } from "@/lib/number-format"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

type ProfileClipsProps = {
  username: string
  clips: UserClip[] | null
  error: Error | null
  isSelf: boolean
}

type GameOption = {
  slug: string
  name: string
  count: number
  iconUrl: string | null
  logoUrl: string | null
}

/**
 * The profile "Home" clips grid with a compact game filter. The chips replace
 * the old large game cards — picking one narrows the grid to that game's clips.
 */
export function ProfileClips({
  username,
  clips,
  error,
  isSelf,
}: ProfileClipsProps) {
  useQueryErrorToast(error, {
    title: "Couldn't load clips",
    toastId: `profile-${username}-clips-error`,
  })
  const [gameSlug, setGameSlug] = React.useState<string | null>(null)

  const gameOptions = React.useMemo<GameOption[]>(() => {
    if (!clips) return []
    const map = new Map<string, GameOption>()
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
    // Most-clipped games first so the handiest filters lead the row.
    return [...map.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    )
  }, [clips])

  // Drop the filter if its game disappears (e.g. a refetch removes the last
  // clip for it), so the grid never strands on an empty selection.
  React.useEffect(() => {
    if (gameSlug && !gameOptions.some((g) => g.slug === gameSlug)) {
      setGameSlug(null)
    }
  }, [gameOptions, gameSlug])

  const selectedGame = gameSlug
    ? (gameOptions.find((g) => g.slug === gameSlug) ?? null)
    : null

  const visible = React.useMemo(() => {
    if (!clips) return null
    return gameSlug ? clips.filter((c) => c.gameRef?.slug === gameSlug) : clips
  }, [clips, gameSlug])

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <FilmIcon className="text-accent" />
            Clips
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

      {gameOptions.length > 0 ? (
        <FilterCarousel className="mb-5">
          <Chip
            size="xl"
            data-active={gameSlug === null ? "true" : undefined}
            onClick={() => setGameSlug(null)}
          >
            All games
          </Chip>
          {gameOptions.map((g) => (
            <Chip
              key={g.slug}
              size="xl"
              data-active={g.slug === gameSlug ? "true" : undefined}
              onClick={() =>
                setGameSlug((prev) => (prev === g.slug ? null : g.slug))
              }
              title={g.name}
            >
              <GameIcon src={g.iconUrl ?? g.logoUrl} name={g.name} />
              <span className="max-w-[10rem] truncate">{g.name}</span>
              <span className="text-foreground-faint tabular-nums">
                {g.count}
              </span>
            </Chip>
          ))}
        </FilterCarousel>
      ) : null}

      <ClipSectionContent
        rows={visible}
        error={error}
        errorSeed={`profile-${username}-clips-error`}
        errorTitle="Couldn't load clips"
        emptySeed={`profile-${username}-clips-empty-${gameSlug ?? "all"}`}
        emptyTitle={
          selectedGame
            ? `No clips for ${selectedGame.name} yet`
            : "No clips uploaded yet"
        }
        emptyHint={
          selectedGame
            ? "Try a different game."
            : "Clips from this user will show up here once they upload."
        }
        listKey={`profile:${username}:clips:${gameSlug ?? ""}`}
        isOwnedByViewer={() => isSelf}
      />
    </section>
  )
}
