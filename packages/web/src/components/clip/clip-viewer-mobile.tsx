import { type ClipRow, clipThumbnailUrl } from "@alloy/api"
import { t } from "@alloy/i18n"
import { DialogClose, DialogViewportContent } from "@alloy/ui/components/dialog"
import { Drawer, DrawerContent, DrawerTitle } from "@alloy/ui/components/drawer"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { useMediaQuery } from "@alloy/ui/hooks/use-media-query"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { Link, useNavigate } from "@tanstack/react-router"
import { XIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { TouchEvent } from "react"

import { mobileOverlayCloseButtonClassName } from "@/components/app/mobile-close-button"
import {
  mobileDrawerContentClass,
  MobileDrawerHandle,
} from "@/components/app/mobile-drawer-surface"
import { DeleteServerBackedDialog } from "@/components/routes/library/library-delete-dialog"
import { useSession } from "@/lib/auth-client"
import { shareUrlWithFallback } from "@/lib/browser-share"
import {
  readSessionStorageItem,
  writeSessionStorageItem,
} from "@/lib/browser-storage"
import { currentUrlWithoutSearchOrHash } from "@/lib/browser-url"
import { clipGameLabel } from "@/lib/clip-format"
import { useLikeStateQuery, useToggleLikeMutation } from "@/lib/clip-queries"
import { recordClipViewBestEffort } from "@/lib/clip-view-tracking"
import { apiOrigin } from "@/lib/env"
import { exitFullscreenBestEffort } from "@/lib/fullscreen"
import { userAvatar } from "@/lib/user-display"

import { ClipComments } from "./clip-comments"
import {
  clipBrowserDownloadActionSupported,
  ClipBrowserDownloadMenuItem,
} from "./clip-download-button"
import type { ClipListEntry } from "./clip-list-context"
import { ClipMentionsRow } from "./clip-mentions-row"
import { ClipTitleWithVisibility, ClipVisibilityBadge } from "./clip-meta"
import { ClipPlayer } from "./clip-player"
import { ClipTagsRow } from "./clip-tags-row"
import { ClipAuthorLink, MobileActionsRail } from "./clip-viewer-mobile-actions"
import { renderHashtagTokens } from "./description-tokens"
import { useClipViewerDelete } from "./use-clip-viewer-delete"

const MOBILE_SWIPE_HINT_SEEN_KEY = "alloy.mobileClipSwipeHintSeen"

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface MobileClipViewerBodyProps {
  row: ClipRow
  onDeleted?: () => void
  prev?: ClipListEntry | null
  next?: ClipListEntry | null
  onNavigate?: ((entry: ClipListEntry) => void) | null
  focusedCommentId?: string | null
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function MobileClipViewerBody({
  row,
  onDeleted,
  prev,
  next,
  onNavigate,
  focusedCommentId = null,
}: MobileClipViewerBodyProps) {
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? null
  const viewerRole =
    (session?.user as { role?: string | null } | undefined)?.role ?? null
  const isOwner = viewerId !== null && viewerId === row.authorId
  const isAdmin = viewerRole === "admin"
  const canManage = isOwner || isAdmin
  const canLike = viewerId !== null
  const canNav = Boolean(onNavigate)

  /* ---- derived ---- */
  const handle = row.authorUsername
  const author = handle
  const avatar = userAvatar({
    id: row.authorId,
    username: handle,
    image: row.authorImage,
  })
  const gameLabel = clipGameLabel(row)
  const thumbnail = row.thumbKey
    ? clipThumbnailUrl(row.id, apiOrigin(), row.thumbVersion ?? undefined)
    : null
  const gameRef = row.gameRef
  const gameIcon = gameRef?.iconUrl ?? gameRef?.logoUrl ?? null

  /* ---- like state ---- */
  const likeQuery = useLikeStateQuery(row.id, { enabled: canLike })
  const likeMut = useToggleLikeMutation()
  const pendingLiked =
    likeMut.isPending && likeMut.variables?.clipId === row.id
      ? likeMut.variables.nextLiked
      : undefined
  const liked = pendingLiked ?? likeQuery.data?.liked ?? false

  /* ---- edit / delete ---- */
  const navigate = useNavigate()
  const deleteFlow = useClipViewerDelete({ row, onDeleted })
  const deleting = deleteFlow.pending

  /* ---- comments panel ---- */
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [showSwipeHint, setShowSwipeHint] = useState(false)

  useEffect(() => {
    setCommentsOpen(false)
  }, [row.id])

  useEffect(() => {
    if (focusedCommentId) setCommentsOpen(true)
  }, [focusedCommentId])

  useEffect(() => {
    if (!canNav || (!prev && !next)) return

    if (readSessionStorageItem(MOBILE_SWIPE_HINT_SEEN_KEY) === "true") return
    writeSessionStorageItem(MOBILE_SWIPE_HINT_SEEN_KEY, "true")

    setShowSwipeHint(true)
    const timer = window.setTimeout(() => setShowSwipeHint(false), 2400)
    return () => window.clearTimeout(timer)
  }, [canNav, next, prev])

  /* ---- swipe gesture ---- */
  const touchRef = useRef<{ y: number; t: number } | null>(null)

  const onTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches.item(0)
    if (!touch) return
    touchRef.current = { y: touch.clientY, t: Date.now() }
  }, [])

  const onTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!touchRef.current) return
      const touch = e.changedTouches.item(0)
      if (!touch) return
      const dy = touch.clientY - touchRef.current.y
      const dt = Date.now() - touchRef.current.t
      touchRef.current = null
      if (dt > 400 || Math.abs(dy) < 60) return
      if (dy < 0 && next && onNavigate) onNavigate(next)
      else if (dy > 0 && prev && onNavigate) onNavigate(prev)
    },
    [next, prev, onNavigate],
  )

  /* ---- handlers ---- */
  const handleLike = useCallback(() => {
    if (!canLike) return
    likeMut.mutate(
      { clipId: row.id, nextLiked: !liked },
      { onError: () => toast.error(t("Couldn't update like")) },
    )
  }, [canLike, row.id, liked, likeMut])

  const handleShare = useCallback(async () => {
    if (row.privacy === "private") {
      toast.error(t("Clip link is disabled"))
      return
    }

    const url = currentUrlWithoutSearchOrHash()
    if (url === null) {
      toast.error(t("Couldn't share clip"))
      return
    }

    const result = await shareUrlWithFallback(url, {
      title: row.title,
      action: "share clip link",
    })
    if (result === "copied") {
      toast.success(t("Link copied"))
    } else if (result === "failed") {
      toast.error(t("Couldn't share clip"))
    }
  }, [row.privacy, row.title])

  const avatarStyle = { background: avatar.bg, color: avatar.fg } as const
  const initialFocusRef = useRef<HTMLDivElement>(null)

  const isLandscape = useMediaQuery("(orientation: landscape)")

  useEffect(() => {
    return () => {
      exitFullscreenBestEffort("mobile clip viewer cleanup")
    }
  }, [])

  const actionRailProps = {
    liked,
    canLike,
    canManage,
    deleting,
    downloadAction: clipBrowserDownloadActionSupported(row) ? (
      <ClipBrowserDownloadMenuItem row={row} />
    ) : undefined,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    onLike: handleLike,
    onComments: () => setCommentsOpen(true),
    onShare: handleShare,
    onEdit: () => {
      // The edit view lives at its own route; navigating there drops the
      // `clip` search param and closes this viewer.
      void navigate({
        to: "/library/clips/$clipId",
        params: { clipId: row.id },
      })
    },
    onDelete: deleteFlow.openDialog,
  }

  return (
    <>
      <DialogViewportContent
        initialFocus={initialFocusRef}
        className="h-dvh w-dvw rounded-none border-0 shadow-none"
      >
        <div
          data-orientation={isLandscape ? t("landscape") : t("portrait")}
          className="relative flex h-full flex-col bg-[oklch(12%_0.01_250)]"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {/* ---- Blurred thumbnail background (full-screen) ---- */}
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0 size-full scale-[1.2] object-cover blur-2xl brightness-[0.35] saturate-150"
            />
          ) : null}

          {/* ---- Landscape metadata overlay ---- */}
          {isLandscape ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-black/70 via-black/35 to-transparent pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.25rem))] pr-[calc(max(0.75rem,calc(env(safe-area-inset-right)+0.25rem))+3rem)] pb-10 pl-[max(0.75rem,calc(env(safe-area-inset-left)+0.25rem))]">
              <ClipAuthorLink
                handle={handle}
                avatar={avatar}
                avatarStyle={avatarStyle}
                author={author}
                size="md"
                className="pointer-events-auto inline-flex shrink-0 items-center gap-2"
                textClassName="text-base font-semibold text-white"
              />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <h2 className="line-clamp-1 min-w-0 text-base font-semibold text-white/90">
                  {row.title}
                </h2>
                {row.privacy !== "public" ? (
                  <ClipVisibilityBadge
                    privacy={row.privacy}
                    className="bg-white/10 text-white/75"
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          {/* ---- Landscape action rail ---- */}
          {isLandscape ? (
            <div className="pointer-events-auto absolute right-[max(0.75rem,calc(env(safe-area-inset-right)+0.25rem))] bottom-[max(3.5rem,calc(env(safe-area-inset-bottom)+1rem))] z-20 flex w-9 flex-col items-center gap-4 drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]">
              <MobileActionsRail
                {...actionRailProps}
                iconSizeClassName="size-6"
                countClassName="text-[11px] font-semibold text-white tabular-nums"
              />
            </div>
          ) : null}

          {/* ---- Close button ---- */}
          <DialogClose
            className={cn(
              mobileOverlayCloseButtonClassName,
              "absolute top-[max(0.75rem,calc(env(safe-area-inset-top)+0.25rem))] right-[max(0.75rem,calc(env(safe-area-inset-right)+0.25rem))] z-30",
            )}
            aria-label={t("Close")}
          >
            <XIcon />
          </DialogClose>

          {/* ---- Top spacer (keeps the player higher while metadata stays bottom-pinned) ---- */}
          {isLandscape ? null : (
            <div className="h-[clamp(4rem,28dvh,16rem)] min-h-0 shrink" />
          )}

          {/* ---- Video player ---- */}
          <div
            ref={initialFocusRef}
            tabIndex={-1}
            className={cn(
              "relative z-10 outline-none",
              isLandscape ? "flex min-h-0 flex-1 items-center" : t("shrink-0"),
            )}
          >
            <ClipPlayer
              clipId={row.id}
              sourceContentType={row.sourceContentType}
              sourceVersion={row.sourceVersion}
              renditions={row.renditions}
              thumbnail={thumbnail}
              thumbnailBlurHash={row.thumbBlurHash}
              fallbackSeed={row.gameId ?? row.id}
              status={row.status}
              encodeProgress={row.encodeProgress}
              maxDisplayHeight={
                isLandscape ? "100dvh" : t("min(72dvh, calc(100dvh - 18rem))")
              }
              chromeSize="compact"
              onPlayThreshold={() => recordClipViewBestEffort(row.id)}
              autoPlay
              enableHorizontalSeekShortcuts={false}
              className={cn(
                "data-[fullscreen=true]:rounded-none",
                // Portrait fills the full width, so the player sits flush
                // against the screen edges; rounded corners would float off
                // them. Only round when landscape centers it with side margins.
                isLandscape ? "rounded-lg" : "rounded-none",
              )}
            />
          </div>

          {showSwipeHint && !isLandscape ? (
            <div
              aria-hidden
              className={cn(
                "pointer-events-none relative z-20 mx-auto mt-3 rounded-full border border-white/10 bg-[oklch(12%_0.01_250)]/35 px-3 py-1.5",
                "text-xs font-semibold tracking-wide text-white/75 shadow-[0_8px_30px_-14px_rgb(0_0_0_/_0.9)] backdrop-blur-md",
                "animate-in duration-200 fade-in-0 slide-in-from-bottom-1",
              )}
            >
              {t("Swipe to navigate")}
            </div>
          ) : null}

          {isLandscape ? null : <div className="min-h-0 flex-1" />}

          {/* ---- Bottom section ---- */}
          <div
            className={cn(
              "relative z-10 flex max-h-[min(40dvh,16rem)] shrink-0 overflow-hidden",
              isLandscape && "hidden",
            )}
          >
            {/* Left: metadata cluster */}
            <div className="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden pt-4 pr-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,calc(env(safe-area-inset-left)+0.25rem))]">
              {/* Game badge */}
              {gameRef ? (
                <Link
                  to="/games/$gameId"
                  params={{ gameId: gameRef.slug }}
                  className="inline-flex w-fit items-center gap-2"
                >
                  <GameIcon
                    src={gameIcon}
                    name={gameLabel}
                    className="size-6 rounded"
                  />
                  <span className="text-base font-semibold text-white/90">
                    {gameLabel}
                  </span>
                </Link>
              ) : (
                <span className="text-base font-semibold text-white/90">
                  {gameLabel}
                </span>
              )}

              {/* Author with avatar */}
              <ClipAuthorLink
                handle={handle}
                avatar={avatar}
                avatarStyle={avatarStyle}
                author={author}
                size="md"
                className="inline-flex w-fit items-center gap-2"
                textClassName="text-lg font-bold text-white"
              />

              {/* Title */}
              <ClipTitleWithVisibility
                title={row.title}
                privacy={row.privacy}
                titleClassName="line-clamp-2 min-w-0 text-base leading-tight font-semibold text-white"
                badgeClassName="bg-white/10 text-white/75"
              />

              {/* Mentions */}
              <ClipMentionsRow mentions={row.mentions ?? []} />

              {/* Description */}
              {row.description ? (
                <p className="line-clamp-3 text-sm leading-relaxed whitespace-pre-wrap text-white/65">
                  {renderHashtagTokens(row.description, {
                    linkHashtags: true,
                  })}
                </p>
              ) : null}

              {/* Hashtags */}
              <ClipTagsRow tags={row.tags} />
            </div>

            {/* Right: action buttons */}
            <div className="flex flex-col items-center justify-end gap-5 pr-[max(0.75rem,calc(env(safe-area-inset-right)+0.25rem))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-3">
              <MobileActionsRail
                {...actionRailProps}
                iconSizeClassName="size-7"
                countClassName="text-xs font-semibold text-white tabular-nums"
              />
            </div>
          </div>

          {/* ---- Comments drawer (bottom sheet) ---- */}
          <Drawer
            open={commentsOpen}
            onOpenChange={setCommentsOpen}
            direction="bottom"
            handleOnly
          >
            <DrawerContent className={mobileDrawerContentClass}>
              <DrawerTitle className="sr-only">{t("Comments")}</DrawerTitle>
              <MobileDrawerHandle />
              <ClipComments
                clipId={row.id}
                clipAuthorId={row.authorId}
                focusedCommentId={focusedCommentId}
                className="min-h-0 flex-1 overflow-y-scroll border-0 [&>[data-slot=clip-comments-scroll]]:overflow-y-scroll"
              />
            </DrawerContent>
          </Drawer>
        </div>
      </DialogViewportContent>

      <DeleteServerBackedDialog
        open={deleteFlow.open}
        onOpenChange={deleteFlow.setOpen}
        pending={deleteFlow.pending}
        localItem={deleteFlow.localItem}
        title={row.title}
        noun="clip"
        onConfirm={deleteFlow.confirm}
      />
    </>
  )
}

export { MobileClipViewerBody }
