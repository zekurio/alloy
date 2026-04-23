import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import type { ClipRow } from "@workspace/api"

import { ClipCard } from "@workspace/ui/components/clip-card"

import { api } from "@/lib/api"
import { toClipCardData } from "@/lib/clip-format"
import { clipKeys } from "@/lib/clip-queries"

import { setActiveClipList, useClipList } from "./clip-list-context"

export interface ClipCardTriggerProps {
  row: ClipRow
  /** True only when the viewer owns the clip — surfaces the privacy pill. */
  owned?: boolean
  className?: string
  metaVariant?: "default" | "showcase"
}

export function ClipCardTrigger({
  row,
  owned = false,
  className,
  metaVariant = "default",
}: ClipCardTriggerProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const list = useClipList()
  const card = React.useMemo(() => toClipCardData(row), [row])

  const gameSlug = card.gameRef?.slug ?? null
  const gameHref = gameSlug ? `/g/${gameSlug}` : null
  const authorHref = card.authorUsername ? `/u/${card.authorUsername}` : null

  const preloadClip = React.useCallback(() => {
    queryClient.setQueryData<ClipRow>(
      clipKeys.detail(row.id),
      (current) => current ?? row
    )
    void queryClient.prefetchQuery({
      queryKey: clipKeys.detail(row.id),
      queryFn: () => api.clips.fetchById(row.id),
    })
  }, [queryClient, row])

  const handleThumbnailClick = React.useCallback(() => {
    if (!gameSlug) return
    preloadClip()
    setActiveClipList(list)
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, clip: card.clipId }),
      mask: {
        to: "/g/$slug/c/$clipId",
        params: { slug: gameSlug, clipId: card.clipId },
      },
    })
  }, [navigate, gameSlug, card.clipId, list, preloadClip])

  return (
    <ClipCard
      className={className}
      title={card.title}
      author={card.author}
      authorSeed={card.authorId}
      authorImage={card.authorImage}
      authorHref={authorHref}
      game={card.game}
      gameIcon={card.gameRef?.iconUrl ?? null}
      gameHref={gameHref}
      views={card.views}
      likes={card.likes}
      comments={card.comments}
      postedAt={card.postedAt}
      thumbnail={card.thumbnail}
      accentHue={card.accentHue}
      streamUrl={card.streamUrl}
      privacy={owned ? card.privacy : undefined}
      metaVariant={metaVariant}
      onThumbnailClick={handleThumbnailClick}
      onThumbnailIntent={preloadClip}
      thumbnailLabel={`Play clip: ${card.title}`}
    />
  )
}
