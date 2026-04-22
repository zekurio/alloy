import * as React from "react"
import { useNavigate } from "@tanstack/react-router"

import { ClipCard } from "@workspace/ui/components/clip-card"

import type { ClipCardData } from "@/lib/clip-format"

import { setActiveClipList, useClipList } from "./clip-list-context"

export interface ClipCardTriggerProps {
  card: ClipCardData
  /** True only when the viewer owns the clip — surfaces the privacy pill. */
  owned?: boolean
  className?: string
}

export function ClipCardTrigger({
  card,
  owned = false,
  className,
}: ClipCardTriggerProps) {
  const navigate = useNavigate()
  const list = useClipList()

  const gameSlug = card.gameRef?.slug ?? null
  const gameHref = gameSlug ? `/g/${gameSlug}` : null
  const authorHref = card.authorUsername ? `/u/${card.authorUsername}` : null

  const handleThumbnailClick = React.useCallback(() => {
    if (!gameSlug) return
    setActiveClipList(list)
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, clip: card.clipId }),
      mask: {
        to: "/g/$slug/c/$clipId",
        params: { slug: gameSlug, clipId: card.clipId },
      },
    })
  }, [navigate, gameSlug, card.clipId, list])

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
      onThumbnailClick={handleThumbnailClick}
      thumbnailLabel={`Play clip: ${card.title}`}
    />
  )
}
