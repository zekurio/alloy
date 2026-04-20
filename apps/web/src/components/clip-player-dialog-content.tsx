import { DialogContent } from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import { recordView } from "../lib/clips-api"

import type { ClipCardTriggerProps } from "./clip-player-dialog"
import { ClipComments } from "./clip-comments"
import { ClipMeta } from "./clip-meta"
import { ClipPlayer } from "./clip-player"

/**
 * The popup itself — wide, two-column, player on the left and comments
 * flush on the right. Kept in a lazy-loaded module so closed feed cards
 * don't instantiate player/comments/meta trees until a dialog actually opens.
 */
function ClipPlayerDialogContent({
  clipId,
  thumbnail,
  variants,
  authorHandle,
  authorId,
  author,
  authorImage,
  title,
  game,
  gameRef,
  views,
  likes,
  comments,
  postedAt,
  accentHue,
  clipPrivacy,
  description,
}: Omit<
  ClipCardTriggerProps,
  "streamUrl" | "className" | "privacy" | "gameHref"
>) {
  const initials = author.slice(0, 2).toUpperCase()
  const likesN = parseCount(likes)
  const commentsN = parseCount(comments)

  return (
    <DialogContent
      className={cn(
        // Override DialogContent's default 440px cap.
        "h-[96vh] max-h-[1200px] w-[95vw] max-w-[1480px] max-w-none",
        "grid overflow-hidden p-0",
        "[grid-template-columns:1fr_400px] xl:[grid-template-columns:1fr_480px]"
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <ClipPlayer
          clipId={clipId}
          thumbnail={thumbnail}
          variants={variants}
          onPlayThreshold={() => void recordView(clipId)}
        />
        <ClipMeta
          clipId={clipId}
          authorId={authorId}
          title={title}
          game={game}
          gameRef={gameRef}
          views={views}
          postedAt={postedAt}
          likes={likesN}
          comments={commentsN}
          privacy={clipPrivacy}
          description={description}
          uploader={{
            handle: authorHandle,
            name: author,
            avatar: {
              initials,
              src: authorImage ?? undefined,
              bg: `oklch(0.32 0.18 ${accentHue})`,
              fg: `oklch(0.95 0.1 ${accentHue})`,
            },
          }}
        />
      </div>

      <ClipComments clipId={clipId} className="min-h-0" />
    </DialogContent>
  )
}

// "12.4k" / "1.3k" / "842" → number. Used to round-trip the card's
// pre-formatted strings into the integer counts ClipMeta expects.
function parseCount(s: string): number {
  const trimmed = s.trim().toLowerCase()
  if (trimmed === "—" || trimmed === "-") return 0
  const num = Number.parseFloat(trimmed)
  if (Number.isNaN(num)) return 0
  if (trimmed.endsWith("k")) return Math.round(num * 1_000)
  if (trimmed.endsWith("m")) return Math.round(num * 1_000_000)
  return Math.round(num)
}

export { ClipPlayerDialogContent }
