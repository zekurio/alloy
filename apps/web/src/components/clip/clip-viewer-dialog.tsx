import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogViewportContent,
} from "@workspace/ui/components/dialog"
import { Spinner } from "@workspace/ui/components/spinner"
import { useMediaQuery } from "@workspace/ui/hooks/use-media-query"
import { cn } from "@workspace/ui/lib/utils"

import { clipThumbnailUrl, type ClipRow } from "@workspace/api"

import { api } from "@/lib/api"
import {
  clipGameLabel,
  formatCount,
  formatRelativeTime,
} from "@/lib/clip-format"
import { clipKeys, useClipQuery } from "@/lib/clip-queries"
import { commentKeys } from "@/lib/comment-queries"
import { apiOrigin } from "@/lib/env"
import { userAvatar } from "@/lib/user-display"

import { ClipComments } from "./clip-comments"
import { ClipEditDialog } from "./clip-edit-dialog"
import { useActiveClipList, type ClipListEntry } from "./clip-list-context"
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
  const [autoAdvance, setAutoAdvance] = React.useState(false)

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
    [onNavigate, queryClient]
  )

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (isEditableKeyTarget(event.target)) return
      if (event.key === "ArrowLeft" && prev) {
        event.preventDefault()
        navigateTo(prev)
      } else if (event.key === "ArrowRight" && next) {
        event.preventDefault()
        navigateTo(next)
      }
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [open, prev, next, navigateTo])

  React.useEffect(() => {
    if (!open) return
    const neighbours = [prev, next].filter((entry): entry is ClipListEntry =>
      Boolean(entry)
    )
    for (const entry of neighbours) {
      seedClipDetail(queryClient, entry)
      void queryClient.prefetchQuery({
        queryKey: clipKeys.detail(entry.id),
        queryFn: () => api.clips.fetchById(entry.id),
      })
      void queryClient.prefetchInfiniteQuery({
        queryKey: commentKeys.list(entry.id, "top", 30),
        queryFn: ({ pageParam }) =>
          api.comments.fetch(entry.id, "top", {
            limit: 30,
            cursor: pageParam,
          }),
        initialPageParam: null as string | null,
      })
    }
  }, [open, prev, next, queryClient])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      {open ? (
        query.data ? (
          !isDesktop ? (
            <MobileClipViewerBody
              row={query.data}
              onDeleted={onClose}
              prev={prev}
              next={next}
              onNavigate={onNavigate ? navigateTo : null}
              focusedCommentId={focusedCommentId}
              autoAdvance={autoAdvance}
              onAutoAdvanceChange={setAutoAdvance}
            />
          ) : (
            <ClipViewerDialogBody
              row={query.data}
              onDeleted={onClose}
              prev={prev}
              next={next}
              onNavigate={onNavigate ? navigateTo : null}
              focusedCommentId={focusedCommentId}
              autoAdvance={autoAdvance}
              onAutoAdvanceChange={setAutoAdvance}
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
  entry: ClipListEntry
) {
  const row = entry.row
  if (!row) return
  queryClient.setQueryData<ClipRow>(
    clipKeys.detail(entry.id),
    (current) => current ?? row
  )
}

interface ClipViewerDialogBodyProps {
  row: ClipRow
  /** Fires after the clip is deleted — used to dismiss the dialog. */
  onDeleted?: () => void
  prev?: ClipListEntry | null
  next?: ClipListEntry | null
  onNavigate?: ((entry: ClipListEntry) => void) | null
  focusedCommentId?: string | null
  autoAdvance: boolean
  onAutoAdvanceChange: (next: boolean) => void
}

function ClipViewerDialogBody({
  row,
  onDeleted,
  prev,
  next,
  onNavigate,
  focusedCommentId = null,
  autoAdvance,
  onAutoAdvanceChange,
}: ClipViewerDialogBodyProps) {
  const [editOpen, setEditOpen] = React.useState(false)
  const handle = row.authorUsername
  const author = row.authorName || handle
  const avatar = userAvatar({
    id: row.authorId,
    username: handle,
    name: author,
    image: row.authorImage,
  })
  const gameLabel = clipGameLabel(row)
  const thumbnail = row.thumbKey ? clipThumbnailUrl(row.id, apiOrigin()) : null
  const initialFocusRef = React.useRef<HTMLDivElement>(null)

  const canNavigate = Boolean(onNavigate)
  // Render both chevrons whenever navigation is wired up — matches medal.tv,
  // where the arrows are always visible and just disabled at list boundaries
  // (or when the viewer was opened outside of a browsable list).
  const showPrev = canNavigate
  const showNext = canNavigate
  const prevDisabled = !prev
  const nextDisabled = !next
  const handleEnded = React.useCallback(() => {
    if (autoAdvance && next && onNavigate) onNavigate(next)
  }, [autoAdvance, next, onNavigate])

  // Modal sizing is driven from the 16:9 video frame + a fixed-width comments
  // rail (Medal-style). All four numbers below are exposed as CSS variables so
  // the lg/xl breakpoints can override individual pieces without having to
  // rewrite the full calc(). `--clip-modal-margin-*` is the gutter PER side.
  //
  //   video_h  = min(dvh - 2*margin_y - meta,  (dvw - 2*margin_x - sidebar) * 9/16)
  //   modal_h  = video_h + meta
  //   modal_w  = (video_h * 16/9) + sidebar
  //
  // This keeps the modal short-and-wide (matching medal.tv) instead of letting
  // it stretch to the full viewport height the way the inherited
  // DialogViewportContent defaults would.
  return (
    <>
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
          // lg: explicit, coupled width + height that track the 16:9 video.
          // Side gutters are deliberately wider than the top/bottom margins so
          // the modal sits closer to the viewport's vertical edges while still
          // leaving plenty of room for the prev/next chevrons on the sides —
          // matches medal.tv's spacing.
          "lg:[--clip-modal-margin-x:160px] lg:[--clip-modal-margin-y:20px] lg:[--clip-modal-nav-gutter:72px]",
          "lg:h-[calc(min(calc(100dvh-var(--clip-modal-margin-y)*2-var(--clip-modal-meta)),calc((100dvw-var(--clip-modal-margin-x)*2-var(--clip-modal-nav-gutter)*2-var(--clip-modal-sidebar))*9/16))+var(--clip-modal-meta))]",
          "lg:max-h-[calc(100dvh-var(--clip-modal-margin-y)*2)]",
          "lg:w-[calc(min(calc(100dvw-var(--clip-modal-margin-x)*2-var(--clip-modal-nav-gutter)*2-var(--clip-modal-sidebar)),calc((100dvh-var(--clip-modal-margin-y)*2-var(--clip-modal-meta))*16/9))+var(--clip-modal-sidebar))]",
          "lg:max-w-[calc(100dvw-var(--clip-modal-margin-x)*2-var(--clip-modal-nav-gutter)*2)]",
          // xl: wider sidebar + extra horizontal gutter, still slim vertically.
          "xl:[--clip-modal-margin-x:200px] xl:[--clip-modal-margin-y:24px] xl:[--clip-modal-meta:14rem] xl:[--clip-modal-sidebar:448px]",
          // 2xl: max breathing room for chevrons + meta on ultrawide.
          "2xl:[--clip-modal-margin-x:256px] 2xl:[--clip-modal-margin-y:28px]"
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
              "hidden lg:inline-flex"
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
              "hidden lg:inline-flex"
            )}
          >
            <ChevronRightIcon />
          </Button>
        ) : null}
        <div
          className={cn(
            "grid h-full min-h-0 overflow-hidden rounded-[20px] bg-surface",
            "lg:grid-cols-[minmax(0,1fr)_var(--clip-modal-sidebar)]"
          )}
        >
          <div className="grid min-h-0 grid-rows-[auto_auto] bg-surface p-4 sm:p-6 lg:grid-rows-[auto_minmax(0,1fr)] lg:p-0">
            <div
              ref={initialFocusRef}
              tabIndex={-1}
              className="relative aspect-[16/9] w-full overflow-hidden outline-none"
            >
              <ClipPlayer
                clipId={row.id}
                sourceContentType={row.contentType}
                width={row.width}
                height={row.height}
                thumbnail={thumbnail}
                variants={row.variants}
                status={row.status}
                encodeProgress={row.encodeProgress}
                aspectRatio={16 / 9}
                className="h-full w-full overflow-hidden rounded-[14px] shadow-[0_30px_90px_-42px_rgba(0,0,0,0.92)] ring-1 ring-white/10 ring-inset lg:rounded-none lg:shadow-none lg:ring-0"
                onPlayThreshold={() => void api.clips.recordView(row.id)}
                onEnded={handleEnded}
                autoPlay
                autoAdvance={canNavigate ? autoAdvance : undefined}
                onAutoAdvanceChange={onAutoAdvanceChange}
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
                onEdit={() => setEditOpen(true)}
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

      <ClipEditDialog open={editOpen} onOpenChange={setEditOpen} row={row} />
    </>
  )
}

function ClipViewerDialogFallback() {
  return (
    <DialogViewportContent className="grid place-items-center">
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface">
        <Spinner className="size-5" />
      </div>
    </DialogViewportContent>
  )
}
