import { clipDownloadUrl, type ClipRow, clipThumbnailUrl } from "@alloy/api"
import { t } from "@alloy/i18n"
import { DialogClose, DialogViewportContent } from "@alloy/ui/components/dialog"
import { useMediaQuery } from "@alloy/ui/hooks/use-media-query"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { Link, useNavigate } from "@tanstack/react-router"
import { XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"

import { mobileOverlayCloseButtonClassName } from "@/components/app/mobile-close-button"
import { GameIcon } from "@/components/game/game-icon"
import { DeleteServerBackedDialog } from "@/components/routes/library/library-delete-dialog"
import { startBrowserDownload } from "@/lib/browser-download"
import {
  readSessionStorageItem,
  writeSessionStorageItem,
} from "@/lib/browser-storage"
import { clipGameLabel } from "@/lib/clip-format"
import { useReannounceClipMutation } from "@/lib/clip-queries"
import { recordClipViewBestEffort } from "@/lib/clip-view-tracking"
import { apiOrigin } from "@/lib/env"
import { exitFullscreenBestEffort } from "@/lib/fullscreen"
import { userAvatar } from "@/lib/user-display"

import { clipBrowserDownloadActionSupported } from "./clip-download-button"
import type { ClipListEntry } from "./clip-list-context"
import { ClipMentionsRow } from "./clip-mentions-row"
import { ClipTitleWithVisibility, ClipVisibilityBadge } from "./clip-meta"
import { ClipPlayer } from "./clip-player"
import { ClipTagsRow } from "./clip-tags-row"
import { ClipAuthorLink, MobileActionsRail } from "./clip-viewer-mobile-actions"
import { renderHashtagTokens } from "./description-tokens"
import { useClipAccess } from "./use-clip-access"
import { useClipRetry } from "./use-clip-retry"
import { useClipShare } from "./use-clip-share"
import { useClipViewerDelete } from "./use-clip-viewer-delete"
import { useVerticalPaging } from "./use-vertical-paging"

const MOBILE_SWIPE_HINT_SEEN_KEY = "alloy.mobileClipSwipeHintSeen"
/** Videos keep the 16:9 frame the desktop viewer uses. */
const VIDEO_ASPECT_RATIO = 16 / 9
/** Hides landscape overlays while the player hides its own controls. */
const FADE_WITH_PLAYER_CHROME = cn(
  "transition-opacity duration-300",
  "group-has-[[data-chrome=hidden]]/viewer:pointer-events-none group-has-[[data-chrome=hidden]]/viewer:opacity-0",
)

interface MobileClipViewerBodyProps {
  row: ClipRow
  onDeleted?: () => void
  prev?: ClipListEntry | null
  next?: ClipListEntry | null
  onNavigate?: ((entry: ClipListEntry) => void) | null
}

function MobileClipViewerBody({
  row,
  onDeleted,
  prev,
  next,
  onNavigate,
}: MobileClipViewerBodyProps) {
  const { isAdmin, canManage } = useClipAccess(row.authorId)
  const canNav = Boolean(onNavigate)

  /* ---- derived ---- */
  const handle = row.authorUsername
  const author = handle
  const avatar = userAvatar({
    id: row.authorId,
    username: handle,
    image: row.authorImage,
  })
  const thumbnail = clipThumbnail(row)
  const gameRef = row.gameRef

  const share = useClipShare({
    clipId: row.id,
    gameSlug: gameRef?.slug ?? null,
    title: row.title,
    privacy: row.privacy,
  })

  /* ---- edit / delete ---- */
  const navigate = useNavigate()
  const deleteFlow = useClipViewerDelete({ row, onDeleted })
  const deleting = deleteFlow.pending
  const retry = useClipRetry(row)

  /* ---- swipe hint ---- */
  const [showSwipeHint, setShowSwipeHint] = useState(false)

  useEffect(() => {
    if (!canNav || (!prev && !next)) return

    if (readSessionStorageItem(MOBILE_SWIPE_HINT_SEEN_KEY) === "true") return
    writeSessionStorageItem(MOBILE_SWIPE_HINT_SEEN_KEY, "true")

    setShowSwipeHint(true)
  }, [canNav, next, prev])

  // Hiding keys off the hint itself: a re-run of the effect above (new
  // neighbours, StrictMode) takes the "seen" early return and would otherwise
  // cancel the only timer that hides it.
  useEffect(() => {
    if (!showSwipeHint) return
    const timer = window.setTimeout(() => setShowSwipeHint(false), 2400)
    return () => window.clearTimeout(timer)
  }, [showSwipeHint])

  /* ---- swipe gesture ---- */
  const paging = useVerticalPaging({
    prev: prev ?? null,
    next: next ?? null,
    onPage: onNavigate ?? null,
    pageKey: row.id,
  })

  const avatarStyle = { background: avatar.bg, color: avatar.fg } as const
  const initialFocusRef = useRef<HTMLDivElement>(null)

  const isLandscape = useMediaQuery("(orientation: landscape)")

  useEffect(() => {
    return () => {
      exitFullscreenBestEffort("mobile clip viewer cleanup")
    }
  }, [])

  const reannounce = useReannounceClipMutation()
  const actionRailProps = {
    clipTitle: row.title,
    canManage,
    deleting,
    canDownload: clipBrowserDownloadActionSupported(row),
    reannounce:
      isAdmin && row.status === "ready" && row.privacy === "public"
        ? {
            disabled: Boolean(row.encodeActive) || reannounce.isPending,
            // The hook toasts both outcomes, and this component outlives the
            // sheet that closes on tap.
            onReannounce: () => reannounce.mutate({ clipId: row.id }),
          }
        : null,
    shareState: share.feedback.state,
    shareError:
      share.feedback.state === "error" ? share.feedback.message : null,
    shareDisabled: row.privacy === "private",
    onShare: share.share,
    onDownload: () => {
      if (!startBrowserDownload(clipDownloadUrl(row.id, apiOrigin()))) {
        toast.error(t("Couldn't start download"))
      }
    },
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
        {/* A black page whatever the theme, like other phone video viewers.
            The forced `dark` subtree keeps the details, tags and mentions on
            the dark theme's colours, readable against it. */}
        <div
          data-slot="mobile-clip-viewer"
          data-orientation={isLandscape ? "landscape" : "portrait"}
          className="group/viewer dark relative h-full touch-none overflow-hidden bg-black"
          {...paging.handlers}
        >
          {/* ---- Page track: neighbours wait above and below the clip ---- */}
          <div ref={paging.trackRef} className="absolute inset-0">
            {prev?.row ? (
              <NeighbourPage
                row={prev.row}
                isLandscape={isLandscape}
                className="-translate-y-full"
              />
            ) : null}

            <ClipPage
              row={row}
              isLandscape={isLandscape}
              media={
                <div
                  ref={initialFocusRef}
                  tabIndex={-1}
                  className="w-full outline-none"
                >
                  <ClipPlayer
                    clipId={row.id}
                    aspectRatio={clipPageAspectRatio(row)}
                    playbackContentType={row.playbackContentType}
                    sourceCodecs={row.sourceCodecs}
                    sourceVersion={row.sourceVersion}
                    renditions={row.renditions}
                    durationMs={row.durationMs}
                    trimStartMs={row.trimStartMs}
                    trimEndMs={row.trimEndMs}
                    thumbnail={thumbnail}
                    thumbnailBlurHash={row.thumbBlurHash}
                    fallbackSeed={row.gameId ?? row.id}
                    status={row.status}
                    encodeProgress={row.encodeProgress}
                    encodeStage={row.encodeStage}
                    encodeTier={row.encodeTier}
                    encodeTierIndex={row.encodeTierIndex}
                    encodeTierCount={row.encodeTierCount}
                    failureReason={row.failureReason}
                    canRetry={retry.canRetry}
                    onRetry={retry.onRetry}
                    retryPending={retry.retryPending}
                    maxDisplayHeight="100cqh"
                    chromeSize="compact"
                    onPlayThreshold={() => recordClipViewBestEffort(row.id)}
                    autoPlay
                    enableHorizontalSeekShortcuts={false}
                    className={cn(
                      // Letterboxing inside the frame is black, as on desktop.
                      "bg-black data-[fullscreen=true]:rounded-none",
                      // Portrait fills the full width, so the player sits
                      // flush against the screen edges; rounded corners would
                      // float off them. Only round when landscape centers it
                      // with side margins.
                      isLandscape ? "rounded-lg" : "rounded-none",
                    )}
                  />
                </div>
              }
            />

            {next?.row ? (
              <NeighbourPage
                row={next.row}
                isLandscape={isLandscape}
                className="translate-y-full"
              />
            ) : null}
          </div>

          {/* ---- Landscape metadata overlay ---- */}
          {isLandscape ? (
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-black/70 via-black/35 to-transparent pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.25rem))] pr-[calc(max(0.75rem,calc(env(safe-area-inset-right)+0.25rem))+3rem)] pb-10 pl-[max(0.75rem,calc(env(safe-area-inset-left)+0.25rem))]",
                FADE_WITH_PLAYER_CHROME,
              )}
            >
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

          {/* ---- Action rail: stays put while pages slide past ---- */}
          <div
            className={cn(
              "absolute z-20 flex flex-col items-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]",
              isLandscape
                ? cn(
                    "right-[max(0.75rem,calc(env(safe-area-inset-right)+0.25rem))] bottom-[max(3.5rem,calc(env(safe-area-inset-bottom)+1rem))] w-9 gap-4",
                    FADE_WITH_PLAYER_CHROME,
                  )
                : "right-[max(0.75rem,calc(env(safe-area-inset-right)+0.25rem))] bottom-[max(1.25rem,env(safe-area-inset-bottom))] gap-5",
            )}
          >
            <MobileActionsRail
              {...actionRailProps}
              iconSizeClassName={isLandscape ? "size-6" : "size-7"}
            />
          </div>

          {/* ---- Close button ---- */}
          <DialogClose
            className={cn(
              mobileOverlayCloseButtonClassName,
              "absolute top-[max(0.75rem,calc(env(safe-area-inset-top)+0.25rem))] right-[max(0.75rem,calc(env(safe-area-inset-right)+0.25rem))] z-30",
              isLandscape && FADE_WITH_PLAYER_CHROME,
            )}
            aria-label={t("Close")}
          >
            <XIcon />
          </DialogClose>

          {showSwipeHint && !isLandscape ? (
            <div
              aria-hidden
              className={cn(
                "border-border bg-surface-raised/90 pointer-events-none absolute inset-x-0 top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] z-30 mx-auto w-fit rounded-full border px-3 py-1.5",
                "text-foreground-muted text-xs font-semibold tracking-wide shadow-md backdrop-blur-md",
                "animate-in animation-duration-200 fade-in-0 slide-in-from-top-1",
              )}
            >
              {t("Swipe to navigate")}
            </div>
          ) : null}
        </div>
      </DialogViewportContent>

      <DeleteServerBackedDialog
        open={deleteFlow.open}
        onOpenChange={deleteFlow.setOpen}
        pending={deleteFlow.pending}
        error={deleteFlow.error}
        localItem={deleteFlow.localItem}
        title={row.title}
        noun="clip"
        onConfirm={deleteFlow.confirm}
      />
    </>
  )
}

function clipThumbnail(row: ClipRow): string | null {
  return row.thumbKey
    ? clipThumbnailUrl(row.id, apiOrigin(), row.thumbVersion ?? undefined)
    : null
}

function clipPageAspectRatio(row: ClipRow): number {
  return row.mediaKind === "image" && row.width && row.height
    ? row.width / row.height
    : VIDEO_ASPECT_RATIO
}

/**
 * One page of the viewer: the media centred in the space above the clip's
 * details; landscape leaves the whole screen to the media. A neighbour page
 * shares this layout, so the clip that slides in lands exactly where the
 * player then takes over.
 */
function ClipPage({
  row,
  isLandscape,
  media,
  className,
  inert,
}: {
  row: ClipRow
  isLandscape: boolean
  media: ReactNode
  className?: string
  inert?: boolean
}) {
  return (
    <div
      className={cn("absolute inset-0 flex flex-col", className)}
      inert={inert}
      aria-hidden={inert}
    >
      <div className="[container-type:size] flex min-h-0 flex-1 items-center justify-center">
        {media}
      </div>
      {isLandscape ? null : <ClipPageDetails row={row} />}
    </div>
  )
}

/** A neighbouring clip's poster and details, shown while a swipe pulls it in. */
function NeighbourPage({
  row,
  isLandscape,
  className,
}: {
  row: ClipRow
  isLandscape: boolean
  className: string
}) {
  const thumbnail = clipThumbnail(row)
  const ratio = clipPageAspectRatio(row)
  const frameStyle: CSSProperties = {
    aspectRatio: String(ratio),
    width: `min(100%, calc(100cqh * ${ratio}))`,
    maxHeight: "100cqh",
  }
  return (
    <ClipPage
      row={row}
      isLandscape={isLandscape}
      className={className}
      inert
      media={
        thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className={cn(
              "bg-black object-contain",
              isLandscape ? "rounded-lg" : "rounded-none",
            )}
            style={frameStyle}
            decoding="async"
          />
        ) : (
          <div className="bg-black" style={frameStyle} />
        )
      }
    />
  )
}

/** Game, author, title and the rest, bottom-left beside the action rail. */
function ClipPageDetails({ row }: { row: ClipRow }) {
  const gameLabel = clipGameLabel(row)
  const gameRef = row.gameRef
  const gameIcon = gameRef?.iconUrl ?? gameRef?.logoUrl ?? null
  const avatar = userAvatar({
    id: row.authorId,
    username: row.authorUsername,
    image: row.authorImage,
  })
  const avatarStyle = { background: avatar.bg, color: avatar.fg } as const

  return (
    <div
      className={cn(
        "relative z-10 flex max-h-[min(40dvh,16rem)] min-h-0 shrink-0 flex-col justify-end gap-2.5 overflow-hidden pt-4",
        // Room for the action rail, which sits outside the sliding page.
        "pr-[calc(max(0.75rem,calc(env(safe-area-inset-right)+0.25rem))+2.75rem)] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,calc(env(safe-area-inset-left)+0.25rem))]",
      )}
    >
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
          <span className="text-foreground text-base font-semibold">
            {gameLabel}
          </span>
        </Link>
      ) : (
        <span className="text-foreground text-base font-semibold">
          {gameLabel}
        </span>
      )}

      <ClipAuthorLink
        handle={row.authorUsername}
        avatar={avatar}
        avatarStyle={avatarStyle}
        author={row.authorUsername}
        size="md"
        className="inline-flex w-fit items-center gap-2"
        textClassName="text-foreground text-lg font-bold"
      />

      <ClipTitleWithVisibility
        title={row.title}
        privacy={row.privacy}
        titleClassName="text-foreground line-clamp-2 min-w-0 text-base leading-tight font-semibold"
      />

      <ClipMentionsRow mentions={row.mentions ?? []} />

      {row.description ? (
        <p className="text-foreground-muted line-clamp-3 text-sm leading-relaxed whitespace-pre-wrap">
          {renderHashtagTokens(row.description)}
        </p>
      ) : null}

      <ClipTagsRow tags={row.tags} />
    </div>
  )
}

export { MobileClipViewerBody }
