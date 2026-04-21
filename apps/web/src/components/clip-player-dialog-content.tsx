import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { DialogViewportContent } from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import {
  clipGameLabel,
  formatCount,
  formatRelativeTime,
} from "../lib/clip-format"
import { clipThumbnailUrl, recordView, type ClipRow } from "../lib/clips-api"
import { avatarTint, displayInitials } from "../lib/user-display"

import { ClipEditDialog } from "./clip-edit-sheet"
import type { ClipListEntry } from "./clip-list-context"
import { ClipComments } from "./clip-comments"
import { ClipMeta } from "./clip-meta"
import { ClipPlayer } from "./clip-player"

interface ClipPlayerDialogContentProps {
  row: ClipRow
  /** Fires after the clip is deleted — used to dismiss the modal. */
  onDeleted?: () => void
  prev?: ClipListEntry | null
  next?: ClipListEntry | null
  onNavigate?: ((entry: ClipListEntry) => void) | null
}

function ClipPlayerDialogContent({
  row,
  onDeleted,
  prev,
  next,
  onNavigate,
}: ClipPlayerDialogContentProps) {
  const [editOpen, setEditOpen] = React.useState(false)
  const handle = row.authorUsername
  const author = row.authorName || handle
  const initials = displayInitials(author)
  const { bg, fg } = avatarTint(row.authorId || handle)
  const gameLabel = clipGameLabel(row)
  const thumbnail = row.thumbKey ? clipThumbnailUrl(row.id) : null
  const avatarSrc = row.authorImage ?? undefined

  const canNavigate = Boolean(onNavigate)
  const showPrev = canNavigate && Boolean(prev)
  const showNext = canNavigate && Boolean(next)
  const gutterOffsetLeftClass = "-left-16"
  const gutterOffsetRightClass = "-right-16"

  return (
    <>
      <DialogViewportContent className="overflow-visible rounded-[20px]">
        {showPrev ? (
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            onClick={() => (prev && onNavigate ? onNavigate(prev) : undefined)}
            aria-label="Previous clip"
            className={cn(
              "absolute top-1/2 z-20 -translate-y-1/2 rounded-full border-white/12 bg-black/55 text-white shadow-[0_24px_80px_-32px_rgba(0,0,0,0.95)] backdrop-blur-md",
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
            variant="outline"
            size="icon-lg"
            onClick={() => (next && onNavigate ? onNavigate(next) : undefined)}
            aria-label="Next clip"
            className={cn(
              "absolute top-1/2 z-20 -translate-y-1/2 rounded-full border-white/12 bg-black/55 text-white shadow-[0_24px_80px_-32px_rgba(0,0,0,0.95)] backdrop-blur-md",
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
                aspectRatio={16 / 9}
                className="overflow-hidden rounded-[14px] border border-white/10 shadow-[0_30px_90px_-42px_rgba(0,0,0,0.92)] lg:rounded-none lg:border-t-0 lg:border-r-0 lg:border-l-0 lg:shadow-[0_30px_90px_-42px_rgba(0,0,0,0.7)] [&_video]:object-cover [&_img]:object-cover"
                onPlayThreshold={() => void recordView(row.id)}
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
                comments={row.commentCount}
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

export { ClipPlayerDialogContent }
