import * as React from "react"

import { DialogContent } from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import {
  clipGameLabel,
  formatCount,
  formatRelativeTime,
} from "../lib/clip-format"
import { clipThumbnailUrl, recordView, type ClipRow } from "../lib/clips-api"
import { avatarTint, displayInitials } from "../lib/user-display"

import { ClipComments } from "./clip-comments"
import { ClipMeta } from "./clip-meta"
import { ClipPlayer } from "./clip-player"

interface ClipPlayerDialogContentProps {
  row: ClipRow
  /** Fires after the clip is deleted — used to dismiss the modal. */
  onDeleted?: () => void
}

function ClipPlayerDialogContent({
  row,
  onDeleted,
}: ClipPlayerDialogContentProps) {
  const handle = row.authorUsername
  const author = row.authorName || handle
  const initials = displayInitials(author)
  const { bg, fg } = avatarTint(row.authorId || handle)
  const gameLabel = clipGameLabel(row)
  const thumbnail = row.thumbKey ? clipThumbnailUrl(row.id) : undefined
  const avatarSrc = row.authorImage ?? undefined

  const [aspectRatio, setAspectRatio] = React.useState<number | null>(null)

  const ratioForLayout = aspectRatio ?? 16 / 9
  const modalWidth = `min(97vw, calc(70vh * ${ratioForLayout} + 480px))`

  return (
    <DialogContent
      className={cn(
        "h-[96vh] max-w-none",
        "grid overflow-hidden p-0",
        "[grid-template-columns:1fr_400px] xl:[grid-template-columns:1fr_480px]"
      )}
      style={{ width: modalWidth }}
    >
      <div className="flex min-h-0 min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <ClipPlayer
          clipId={row.id}
          sourceContentType={row.contentType}
          thumbnail={thumbnail}
          variants={row.variants}
          onPlayThreshold={() => void recordView(row.id)}
          onAspectRatio={setAspectRatio}
        />
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
          onDeleted={onDeleted}
        />
      </div>

      <ClipComments
        clipId={row.id}
        clipAuthorId={row.authorId}
        className="min-h-0"
      />
    </DialogContent>
  )
}

export { ClipPlayerDialogContent }
