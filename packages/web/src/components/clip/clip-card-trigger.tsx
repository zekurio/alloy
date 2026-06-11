import type { ClipRow } from "@alloy/api"
import { ClipCard } from "@alloy/ui/components/clip-card"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import * as React from "react"

import { gameHref, userProfileHref } from "@/lib/app-paths"
import type { AppSearch } from "@/lib/app-search"
import { clientLogger } from "@/lib/client-log"
import { toClipCardData } from "@/lib/clip-format"
import {
  clipDetailQueryOptions,
  seedClipDetailInCache,
} from "@/lib/clip-queries"

import { setActiveClipList, useClipList } from "./clip-list-context"

interface ClipCardTriggerProps {
  row: ClipRow
  /** True only when the viewer owns the clip — surfaces the privacy pill. */
  owned?: boolean
  className?: string
  metaVariant?: "default" | "showcase"
}

export const ClipCardTrigger = React.memo(function ClipCardTrigger({
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
  const gameLink = gameSlug ? gameHref(gameSlug) : null
  const authorHref = card.authorUsername
    ? userProfileHref(card.authorUsername)
    : null

  const preloadClip = React.useCallback(() => {
    seedClipDetailInCache(queryClient, row)
    void queryClient.prefetchQuery(clipDetailQueryOptions(row.id))
  }, [queryClient, row])

  const handleThumbnailClick = React.useCallback(() => {
    if (!gameSlug) return
    preloadClip()
    setActiveClipList(list)
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({ ...prev, clip: card.clipId }),
      mask: {
        to: "/g/$slug/c/$clipId",
        params: { slug: gameSlug, clipId: card.clipId },
      },
    })
  }, [navigate, gameSlug, card.clipId, list, preloadClip])

  const handlePreviewError = React.useCallback((cause: unknown) => {
    clientLogger.warn("[clip-card] Hover preview playback failed.", cause)
  }, [])

  return (
    <ClipCard
      className={className}
      title={card.title}
      author={card.author}
      authorImage={card.authorImage}
      authorInitials={card.authorAvatar.initials}
      authorAvatarBg={card.authorAvatar.bg}
      authorAvatarFg={card.authorAvatar.fg}
      authorHref={authorHref}
      game={card.game}
      gameIcon={card.gameRef?.iconUrl ?? null}
      gameHref={gameLink}
      views={card.views}
      likes={card.likes}
      comments={card.comments}
      postedAt={card.postedAt}
      thumbnail={card.thumbnail}
      thumbnailBlurHash={card.thumbnailBlurHash}
      fallbackSeed={card.fallbackSeed}
      accentHue={card.accentHue}
      streamUrl={card.streamUrl}
      privacy={owned ? card.privacy : undefined}
      metaVariant={metaVariant}
      onThumbnailClick={handleThumbnailClick}
      onThumbnailIntent={preloadClip}
      onPreviewError={handlePreviewError}
      thumbnailLabel={`Play clip: ${card.title}`}
    />
  )
})
