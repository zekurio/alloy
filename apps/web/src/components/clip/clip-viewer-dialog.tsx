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
import { avatarTint, displayInitials, userImageSrc } from "@/lib/user-display"

import { ClipComments } from "./clip-comments"
import { ClipEditDialog } from "./clip-edit-dialog"
import {
  setActiveClipList,
  useActiveClipList,
  type ClipListEntry,
} from "./clip-list-context"
import { ClipMeta } from "./clip-meta"
import { ClipPlayer } from "./clip-player"
import { MobileClipViewerBody } from "./clip-viewer-mobile"

interface ClipViewerDialogProps {
  /** Current dialog target. `null` keeps the viewer closed. */
  clipId: string | null
  /** How to dismiss — typically clears the search param or navigates back. */
  onClose: () => void
  onNavigate?: (entry: ClipListEntry) => void
}

export function ClipViewerDialog({
  clipId,
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

  // Clear the active list when the dialog closes so stale neighbours
  // don't leak into a later viewer open.
  React.useEffect(() => {
    if (!open) setActiveClipList(null)
  }, [open])

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
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
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
  autoAdvance: boolean
  onAutoAdvanceChange: (next: boolean) => void
}

function ClipViewerDialogBody({
  row,
  onDeleted,
  prev,
  next,
  onNavigate,
  autoAdvance,
  onAutoAdvanceChange,
}: ClipViewerDialogBodyProps) {
  const [editOpen, setEditOpen] = React.useState(false)
  const handle = row.authorUsername
  const author = row.authorName || handle
  const initials = displayInitials(author)
  const { bg, fg } = avatarTint(row.authorId || handle)
  const gameLabel = clipGameLabel(row)
  const thumbnail = row.thumbKey ? clipThumbnailUrl(row.id, apiOrigin()) : null
  const avatarSrc = userImageSrc(row.authorImage)

  const canNavigate = Boolean(onNavigate)
  const showPrev = canNavigate && Boolean(prev)
  const showNext = canNavigate && Boolean(next)
  const gutterOffsetLeftClass = "-left-16"
  const gutterOffsetRightClass = "-right-16"
  const handleEnded = React.useCallback(() => {
    if (autoAdvance && next && onNavigate) onNavigate(next)
  }, [autoAdvance, next, onNavigate])

  return (
    <>
      <DialogViewportContent className="overflow-visible rounded-[20px] transition-[filter,opacity,transform] duration-100">
        <DialogClose
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 z-30 hidden rounded-full border border-white/10 bg-black/45 text-white/80 shadow-none backdrop-blur-sm hover:bg-black/60 hover:text-white lg:inline-flex [&_svg]:!size-5"
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
            className={cn(
              "absolute top-1/2 z-20 -translate-y-1/2 rounded-none border-transparent bg-transparent text-white shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-9 [&_svg]:stroke-[2.5]",
              gutterOffsetLeftClass,
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
            className={cn(
              "absolute top-1/2 z-20 -translate-y-1/2 rounded-none border-transparent bg-transparent text-white shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-9 [&_svg]:stroke-[2.5]",
              gutterOffsetRightClass,
              "hidden lg:inline-flex"
            )}
          >
            <ChevronRightIcon />
          </Button>
        ) : null}
        <div
          className={cn(
            "grid h-full min-h-0 overflow-hidden rounded-[20px] bg-surface",
            "lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_448px]"
          )}
        >
          <div className="flex min-h-0 flex-col bg-surface p-4 sm:p-6 lg:p-0">
            <div className="shrink-0">
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
                className="overflow-hidden rounded-[14px] border border-white/10 shadow-[0_30px_90px_-42px_rgba(0,0,0,0.92)] lg:rounded-none lg:border-t-0 lg:border-r-0 lg:border-l-0 lg:shadow-none [&_img]:object-cover [&_video]:object-cover"
                onPlayThreshold={() => void api.clips.recordView(row.id)}
                onEnded={handleEnded}
                autoPlay
                autoAdvance={canNavigate ? autoAdvance : undefined}
                onAutoAdvanceChange={onAutoAdvanceChange}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1 pt-4 sm:pt-6 lg:px-6 lg:pt-4 lg:pb-4 xl:px-8 xl:pb-6">
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
                    initials,
                    src: avatarSrc,
                    bg,
                    fg,
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
            className="min-h-[320px] border-t border-border/70 bg-surface lg:min-h-0 lg:border-t-0 lg:border-l"
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
