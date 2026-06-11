import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { type ClipRow, clipThumbnailUrl } from "alloy-api"
import { Button } from "alloy-ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogViewportContent,
} from "alloy-ui/components/dialog"
import { Spinner } from "alloy-ui/components/spinner"
import { useMediaQuery } from "alloy-ui/hooks/use-media-query"
import { useWindowEvent } from "alloy-ui/hooks/use-window-event"
import { cn } from "alloy-ui/lib/utils"
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react"
import * as React from "react"

import { clipGameLabel } from "@/lib/clip-format"
import {
  clipDetailQueryOptions,
  seedClipDetailInCache,
  useClipQuery,
} from "@/lib/clip-queries"
import { recordClipViewBestEffort } from "@/lib/clip-view-tracking"
import { commentListQueryOptions } from "@/lib/comment-queries"
import { formatRelativeTime } from "@/lib/date-format"
import { apiOrigin } from "@/lib/env"
import { formatCount } from "@/lib/number-format"
import { userAvatar } from "@/lib/user-display"

import { ClipComments } from "./clip-comments"
import {
  type ClipListEntry,
  setActiveClipList,
  useActiveClipList,
} from "./clip-list-context"
import { ClipMeta } from "./clip-meta"
import { ClipPlayer } from "./clip-player"
import { MobileClipViewerBody } from "./clip-viewer-mobile"

interface ClipViewerDialogProps {
  /** Current dialog target. `null` keeps the viewer open. */
  clipId: string | null
  focusedCommentId?: string | null
  /** How to dismiss — typically clears the search param or navigates back. */
  onClose: () => void
  onNavigate?: (entry: ClipListEntry) => void
}

export function ClipViewerDialog({
  clipId,
  focusedCommentId = null,
  onClose,
  onNavigate,
}: ClipViewerDialogProps) {
  const queryClient = useQueryClient()
  // Use lg breakpoint (1024px) so the mobile player covers the range where
  // the desktop grid/sidebar layout hasn't kicked in yet.
  const isDesktop = useMediaQuery("(min-width: 1024px)")
  const open = clipId !== null
  const query = useClipQuery(clipId ?? "")
  const list = useActiveClipList()

  const closeViewer = React.useCallback(() => {
    setActiveClipList(null)
    onClose()
  }, [onClose])

  const prev = React.useMemo(() => {
    if (!list || !clipId) return null
    return list.prevOf(clipId)
  }, [list, clipId])
  const next = React.useMemo(() => {
    if (!list || !clipId) return null
    return list.nextOf(clipId)
  }, [list, clipId])

  const navigateTo = React.useCallback(
    (entry: ClipListEntry) => {
      if (!onNavigate) return
      seedClipDetail(queryClient, entry)
      onNavigate(entry)
    },
    [onNavigate, queryClient],
  )

  const onKey = React.useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (isEditableKeyTarget(event.target)) return
      if (event.key === "ArrowLeft" && prev) {
        event.preventDefault()
        navigateTo(prev)
      } else if (event.key === "ArrowRight" && next) {
        event.preventDefault()
        navigateTo(next)
      }
    },
    [prev, next, navigateTo],
  )
  useWindowEvent("keydown", onKey, true, open)

  React.useEffect(() => {
    if (!open) return
    const neighbours = [prev, next].filter((entry): entry is ClipListEntry =>
      Boolean(entry),
    )
    for (const entry of neighbours) {
      seedClipDetail(queryClient, entry)
      void queryClient.prefetchQuery(clipDetailQueryOptions(entry.id))
      void queryClient.prefetchInfiniteQuery(commentListQueryOptions(entry.id))
    }
  }, [open, prev, next, queryClient])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeViewer()
      }}
    >
      {open ? (
        query.data ? (
          !isDesktop ? (
            <MobileClipViewerBody
              row={query.data}
              onDeleted={closeViewer}
              prev={prev}
              next={next}
              onNavigate={onNavigate ? navigateTo : null}
              focusedCommentId={focusedCommentId}
            />
          ) : (
            <ClipViewerDialogBody
              row={query.data}
              onDeleted={closeViewer}
              prev={prev}
              next={next}
              onNavigate={onNavigate ? navigateTo : null}
              focusedCommentId={focusedCommentId}
            />
          )
        ) : (
          <ClipViewerDialogFallback />
        )
      ) : null}
    </Dialog>
  )
}

function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    tag === "A"
  )
}

function seedClipDetail(
  queryClient: ReturnType<typeof useQueryClient>,
  entry: ClipListEntry,
) {
  const row = entry.row
  if (!row) return
  seedClipDetailInCache(queryClient, row)
}

interface ClipViewerDialogBodyProps {
  row: ClipRow
  /** Fires after the clip is deleted — used to dismiss the dialog. */
  onDeleted?: () => void
  prev?: ClipListEntry | null
  next?: ClipListEntry | null
  onNavigate?: ((entry: ClipListEntry) => void) | null
  focusedCommentId?: string | null
}

function ClipViewerDialogBody({
  row,
  onDeleted,
  prev,
  next,
  onNavigate,
  focusedCommentId = null,
}: ClipViewerDialogBodyProps) {
  const navigate = useNavigate()
  const handle = row.authorUsername
  const author = handle
  const avatar = userAvatar({
    id: row.authorId,
    username: handle,
    image: row.authorImage,
  })
  const gameLabel = clipGameLabel(row)
  const thumbnail = row.thumbKey
    ? clipThumbnailUrl(row.id, apiOrigin(), row.updatedAt)
    : null
  const initialFocusRef = React.useRef<HTMLDivElement>(null)

  const canNavigate = Boolean(onNavigate)
  const showPrev = canNavigate
  const showNext = canNavigate
  const prevDisabled = !prev
  const nextDisabled = !next

  return (
    <DialogViewportContent
      initialFocus={initialFocusRef}
      style={
        {
          "--clip-modal-margin-x": "16px",
          "--clip-modal-margin-y": "16px",
          "--clip-modal-nav-gutter": "72px",
          "--clip-modal-sidebar": "400px",
          "--clip-modal-meta": "13rem",
        } as React.CSSProperties
      }
      className={cn(
        // Below lg this branch is normally hidden by MobileClipViewerBody, but
        // we keep a sensible fallback in case the breakpoint check disagrees.
        "h-auto max-h-[calc(100dvh-32px)] w-[calc(100dvw-32px)] overflow-visible rounded-[20px] bg-surface transition-[filter,opacity,transform] duration-100",
        "lg:[--clip-modal-margin-x:160px] lg:[--clip-modal-margin-y:20px] lg:[--clip-modal-nav-gutter:72px]",
        "lg:h-[calc(min(calc(100dvh-var(--clip-modal-margin-y)*2-var(--clip-modal-meta)),calc((100dvw-var(--clip-modal-margin-x)*2-var(--clip-modal-nav-gutter)*2-var(--clip-modal-sidebar))*9/16))+var(--clip-modal-meta))]",
        "lg:max-h-[calc(100dvh-var(--clip-modal-margin-y)*2)]",
        "lg:w-[calc(min(calc(100dvw-var(--clip-modal-margin-x)*2-var(--clip-modal-nav-gutter)*2-var(--clip-modal-sidebar)),calc((100dvh-var(--clip-modal-margin-y)*2-var(--clip-modal-meta))*16/9))+var(--clip-modal-sidebar))]",
        "lg:max-w-[calc(100dvw-var(--clip-modal-margin-x)*2-var(--clip-modal-nav-gutter)*2)]",
        // xl: wider sidebar + extra horizontal gutter, still slim vertically.
        "xl:[--clip-modal-margin-x:200px] xl:[--clip-modal-margin-y:24px] xl:[--clip-modal-meta:14rem] xl:[--clip-modal-sidebar:448px]",
        // 2xl: max breathing room for chevrons + meta on ultrawide.
        "2xl:[--clip-modal-margin-x:256px] 2xl:[--clip-modal-margin-y:28px]",
      )}
    >
      <DialogClose
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-3 right-3 z-30 hidden rounded-full border-transparent bg-transparent text-white/80 shadow-none hover:border-transparent hover:bg-transparent hover:text-white lg:inline-flex [&_svg]:!size-5"
          />
        }
        aria-label="Close"
      >
        <XIcon />
      </DialogClose>
      {showPrev ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => (prev && onNavigate ? onNavigate(prev) : undefined)}
          aria-label="Previous clip"
          disabled={prevDisabled}
          className={cn(
            "absolute top-1/2 left-[calc((var(--clip-modal-margin-x)+var(--clip-modal-nav-gutter))*-1)] z-40 h-12 w-[calc(var(--clip-modal-margin-x)+var(--clip-modal-nav-gutter))] -translate-y-1/2 rounded-none border-transparent bg-transparent text-white/70 shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:text-white hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-8 [&_svg]:stroke-[2.5]",
            "disabled:cursor-default disabled:text-white/25 disabled:hover:text-white/25",
            "hidden lg:inline-flex",
          )}
        >
          <ChevronLeftIcon />
        </Button>
      ) : null}
      {showNext ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => (next && onNavigate ? onNavigate(next) : undefined)}
          aria-label="Next clip"
          disabled={nextDisabled}
          className={cn(
            "absolute top-1/2 right-[calc((var(--clip-modal-margin-x)+var(--clip-modal-nav-gutter))*-1)] z-40 h-12 w-[calc(var(--clip-modal-margin-x)+var(--clip-modal-nav-gutter))] -translate-y-1/2 rounded-none border-transparent bg-transparent text-white/70 shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:text-white hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-8 [&_svg]:stroke-[2.5]",
            "disabled:cursor-default disabled:text-white/25 disabled:hover:text-white/25",
            "hidden lg:inline-flex",
          )}
        >
          <ChevronRightIcon />
        </Button>
      ) : null}
      <div
        className={cn(
          "grid h-full min-h-0 overflow-hidden rounded-[20px] bg-surface",
          "lg:grid-cols-[minmax(0,1fr)_var(--clip-modal-sidebar)]",
        )}
      >
        <div className="bg-surface grid min-h-0 grid-rows-[auto_auto] p-4 sm:p-6 lg:grid-rows-[auto_minmax(0,1fr)] lg:p-0">
          <div
            ref={initialFocusRef}
            tabIndex={-1}
            className="relative aspect-[16/9] w-full overflow-hidden outline-none"
          >
            <ClipPlayer
              clipId={row.id}
              sourceContentType={row.sourceContentType}
              sourceVideoCodec={row.sourceVideoCodec}
              sourceAudioCodec={row.sourceAudioCodec}
              thumbnail={thumbnail}
              thumbnailBlurHash={row.thumbBlurHash}
              fallbackSeed={row.steamgriddbId}
              status={row.status}
              encodeProgress={row.encodeProgress}
              aspectRatio={16 / 9}
              className="h-full w-full overflow-hidden rounded-[14px] shadow-[0_30px_90px_-42px_rgba(0,0,0,0.92)] ring-1 ring-white/10 ring-inset lg:rounded-none lg:shadow-none lg:ring-0"
              onPlayThreshold={() => recordClipViewBestEffort(row.id)}
              autoPlay
              enableHorizontalSeekShortcuts={false}
            />
          </div>
          <div className="min-h-0 overflow-y-auto px-1 pt-4 sm:pt-6 lg:px-4 lg:pt-3 lg:pb-4 xl:px-5 xl:pt-4 xl:pb-5">
            <ClipMeta
              clipId={row.id}
              authorId={row.authorId}
              title={row.title}
              game={gameLabel}
              gameRef={row.gameRef}
              views={formatCount(row.viewCount)}
              postedAt={formatRelativeTime(row.createdAt)}
              likes={row.likeCount}
              privacy={row.privacy}
              description={row.description}
              mentions={row.mentions ?? []}
              tags={row.tags}
              uploader={{
                handle,
                name: author,
                avatar: {
                  initials: avatar.initials,
                  src: avatar.src,
                  bg: avatar.bg,
                  fg: avatar.fg,
                },
              }}
              onEdit={() => {
                // The edit view lives at its own route; navigating there
                // drops the `clip` search param and closes this viewer.
                void navigate({
                  to: "/library/c/$clipId",
                  params: { clipId: row.id },
                })
              }}
              onDeleted={onDeleted}
            />
          </div>
        </div>

        <ClipComments
          clipId={row.id}
          clipAuthorId={row.authorId}
          focusedCommentId={focusedCommentId}
          className="bg-surface"
        />
      </div>
    </DialogViewportContent>
  )
}

function ClipViewerDialogFallback() {
  return (
    <DialogViewportContent className="grid place-items-center">
      <div className="bg-surface flex h-full w-full flex-col items-center justify-center gap-3">
        <Spinner className="size-5" />
      </div>
    </DialogViewportContent>
  )
}
