import type { ClipRow } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { ClipCard } from "@alloy/ui/components/clip-card"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import * as React from "react"

import { gameHref, userProfileHref } from "@/lib/app-paths"
import type { AppSearch } from "@/lib/app-search"
import { clientLogger } from "@/lib/client-log"
import { PRIVACY_BY_VALUE } from "@/lib/clip-fields"
import { toClipCardData } from "@/lib/clip-format"
import { warmClipDetailCache } from "@/lib/clip-queries"

import { useClipCardAuthorLink, useClipCardGameLink } from "./clip-card-links"
import { setActiveClipList, useClipList } from "./clip-list-context"

interface ClipCardTriggerProps {
  row: ClipRow
  className?: string
  metaVariant?: "default" | "showcase"
  showVisibilityStatus?: boolean
}

export const ClipCardTrigger = React.memo(function ClipCardTrigger({
  row,
  className,
  metaVariant = "default",
  showVisibilityStatus = false,
}: ClipCardTriggerProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const list = useClipList()
  const card = React.useMemo(() => toClipCardData(row), [row])

  const gameId = card.gameRef?.steamgriddbId ?? null
  const gameLink = gameId ? gameHref(gameId) : null
  const authorHref = card.authorUsername
    ? userProfileHref(card.authorUsername)
    : null
  const renderAuthorLink = useClipCardAuthorLink(card.authorUsername)
  const renderGameLink = useClipCardGameLink(gameId)

  const preloadClip = React.useCallback(() => {
    warmClipDetailCache(queryClient, row)
  }, [queryClient, row])

  const handleThumbnailClick = React.useCallback(() => {
    if (!gameId) return
    preloadClip()
    setActiveClipList(list)
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({ ...prev, clip: card.clipId }),
      mask: {
        to: "/games/$gameId/c/$clipId",
        params: { gameId: String(gameId), clipId: card.clipId },
      },
    })
  }, [navigate, gameId, card.clipId, list, preloadClip])

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
      renderAuthorLink={renderAuthorLink}
      game={card.game}
      gameIcon={card.gameRef?.iconUrl ?? null}
      gameHref={gameLink}
      renderGameLink={renderGameLink}
      views={card.views}
      viewCount={card.viewCount}
      likes={card.likes}
      comments={card.comments}
      postedAt={card.postedAt}
      thumbnail={card.thumbnail}
      thumbnailBlurHash={card.thumbnailBlurHash}
      fallbackSeed={card.fallbackSeed}
      accentHue={card.accentHue}
      streamUrl={card.streamUrl}
      metaVariant={metaVariant}
      onThumbnailClick={handleThumbnailClick}
      onTitleClick={handleThumbnailClick}
      onThumbnailIntent={preloadClip}
      onTitleIntent={preloadClip}
      onPreviewError={handlePreviewError}
      thumbnailLabel={tx("Play clip: {title}", { title: card.title })}
      titleLabel={tx("Open clip: {title}", { title: card.title })}
      thumbnailOverlay={
        showVisibilityStatus && card.privacy !== "public" ? (
          <ClipCardVisibilityBadge privacy={card.privacy} />
        ) : null
      }
    />
  )
})

function ClipCardVisibilityBadge({
  privacy,
}: {
  privacy: Exclude<ClipRow["privacy"], "public">
}) {
  const display = PRIVACY_BY_VALUE[privacy]
  const Icon = display.icon

  return (
    <span
      className="pointer-events-none inline-flex h-6 items-center gap-1.5 rounded bg-black/70 px-2 text-xs leading-none font-semibold whitespace-nowrap text-white/90 shadow-sm ring-1 ring-white/10 backdrop-blur-sm"
      title={display.label}
      aria-label={display.label}
    >
      <Icon className="size-3" aria-hidden />
      {display.label}
    </span>
  )
}
