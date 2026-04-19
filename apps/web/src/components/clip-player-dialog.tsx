import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { ClipCard } from "@workspace/ui/components/clip-card"
import { cn } from "@workspace/ui/lib/utils"

import { ClipComments } from "./clip-comments"
import { ClipMeta } from "./clip-meta"
import { ClipPlayer } from "./clip-player"

/**
 * Clickable `ClipCard` that pops open a focused player overlay.
 *
 * Kept as a single component so the call-site API stays identical to the
 * underlying `ClipCard`: pass the same presentational props the grid
 * already has (title, author, game, etc.) plus the hand-off fields the
 * dialog needs to actually play the clip (`clipId`, `streamUrl`,
 * `authorHandle`). Hover-to-play on the card happens via `streamUrl`
 * being forwarded down to `ClipCard`.
 */
export interface ClipCardTriggerProps {
  /** Row id — drives the dialog's `<video src>` through `ClipPlayer`. */
  clipId: string
  /** Precomputed stream URL. Kept separate so the card can play it on hover. */
  streamUrl: string
  /** Optional poster. Omit to let `ClipPlayer` point at the thumbnail endpoint. */
  thumbnail?: string
  /** Uploader's handle — links to `/u/:handle` on the avatar and name. */
  authorHandle: string
  /** Display name shown on the card + meta row. */
  author: string
  /** Uploader avatar URL (from `user.image`); null when not uploaded yet. */
  authorImage?: string | null
  title: string
  game: string
  views: string
  likes: string
  comments: string
  postedAt: string
  accentHue: number
  className?: string
}

export function ClipCardTrigger({
  className,
  clipId,
  streamUrl,
  thumbnail,
  authorHandle,
  author,
  authorImage,
  title,
  game,
  views,
  likes,
  comments,
  postedAt,
  accentHue,
}: ClipCardTriggerProps) {
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  // Base UI restores focus to the trigger on close. For pointer-driven
  // opens that lights up `:focus-visible` and wraps the whole card in a
  // ring — the "silly border" after closing the player. Drop focus on
  // close so only genuine keyboard nav leaves the ring behind.
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Defer past Base UI's own focus restore.
      requestAnimationFrame(() => triggerRef.current?.blur())
    }
  }
  return (
    <Dialog onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <button
            ref={triggerRef}
            type="button"
            className={cn(
              "block cursor-pointer rounded-md text-left",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
              className
            )}
          />
        }
      >
        <ClipCard
          title={title}
          author={author}
          game={game}
          views={views}
          likes={likes}
          comments={comments}
          postedAt={postedAt}
          thumbnail={thumbnail}
          accentHue={accentHue}
          streamUrl={streamUrl}
        />
      </DialogTrigger>

      <ClipPlayerDialogContent
        clipId={clipId}
        thumbnail={thumbnail}
        authorHandle={authorHandle}
        author={author}
        authorImage={authorImage}
        title={title}
        game={game}
        views={views}
        likes={likes}
        comments={comments}
        postedAt={postedAt}
        accentHue={accentHue}
      />
    </Dialog>
  )
}

/**
 * The popup itself — wide, two-column, player on the left and comments
 * flush on the right. Built on top of `DialogContent` so the Alloy
 * backdrop, close X, and animations come for free.
 */
function ClipPlayerDialogContent({
  clipId,
  thumbnail,
  authorHandle,
  author,
  authorImage,
  title,
  game,
  views,
  likes,
  comments,
  postedAt,
  accentHue,
}: Omit<ClipCardTriggerProps, "streamUrl" | "className">) {
  const initials = author.slice(0, 2).toUpperCase()
  const likesN = parseCount(likes)
  const commentsN = parseCount(comments)

  return (
    <DialogContent
      className={cn(
        // override DialogContent's default 440px cap
        "h-[96vh] max-h-[1200px] w-[95vw] max-w-[1480px] max-w-none",
        "grid p-0",
        "[grid-template-columns:1fr_400px] xl:[grid-template-columns:1fr_480px]",
        "overflow-hidden"
      )}
    >
      {/* ── Left: player + metadata ─────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <ClipPlayer clipId={clipId} thumbnail={thumbnail} />
        <ClipMeta
          title={title}
          game={game}
          views={views}
          postedAt={postedAt}
          likes={likesN}
          comments={commentsN}
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

      {/* ── Right: comments rail ────────────────────────────── */}
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
