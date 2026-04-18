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
import type { ClipCardProps } from "@workspace/ui/components/clip-card"

/**
 * Clickable `ClipCard` that pops open a focused player overlay.
 *
 * Kept as a single component so the call-site API stays identical to
 * `ClipCard`: drop one in anywhere a card would go and it "just works".
 * All the dialog-only mock data (duration, quality, uploader followers,
 * comment count) is derived from the card's props so we don't bloat the
 * home-page data.
 */
function ClipCardTrigger({ className, ...cardProps }: ClipCardProps) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className={cn(
              "block cursor-pointer text-left rounded-md",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              className
            )}
          />
        }
      >
        <ClipCard {...cardProps} />
      </DialogTrigger>

      <ClipPlayerDialogContent {...cardProps} />
    </Dialog>
  )
}

/**
 * The popup itself — wide, two-column, player on the left and comments
 * flush on the right. Built on top of `DialogContent` (so the Alloy
 * backdrop, close X and animations come for free) with `p-0` and a grid
 * override to lay out the two panes.
 */
function ClipPlayerDialogContent({
  title,
  author,
  game,
  views,
  likes,
  accentHue,
}: ClipCardProps) {
  // Derive everything we don't carry in card props.
  const hue = accentHue ?? 220
  const likesN = parseCount(likes)
  const commentsN = Math.max(12, Math.floor(likesN / 6))
  const initials = author.slice(0, 2).toUpperCase()

  return (
    <DialogContent
      className={cn(
        // override DialogContent's default 440px cap
        "max-w-none w-[95vw] max-w-[1480px] h-[92vh] max-h-[960px]",
        "p-0 grid",
        "[grid-template-columns:1fr_400px] xl:[grid-template-columns:1fr_480px]",
        "overflow-hidden"
      )}
    >
      {/* ── Left: player + metadata ─────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <ClipPlayer
          title={title}
          game={game}
          accentHue={hue}
          duration="0:48"
          quality="1080p60"
        />
        <ClipMeta
          title={title}
          game={game}
          views={views}
          postedAt="2h ago"
          likes={likesN}
          comments={commentsN}
          uploader={{
            name: author,
            followers: followersFor(author, likesN),
            avatar: {
              initials,
              bg: `oklch(0.32 0.18 ${hue})`,
              fg: `oklch(0.95 0.1 ${hue})`,
            },
          }}
        />
      </div>

      {/* ── Right: comments rail ────────────────────────────── */}
      <ClipComments total={commentsN} className="min-h-0" />
    </DialogContent>
  )
}

// "12.4k" / "1.3k" / "842" → number
function parseCount(s: string): number {
  const trimmed = s.trim().toLowerCase()
  if (trimmed === "—" || trimmed === "-") return 0
  const num = Number.parseFloat(trimmed)
  if (Number.isNaN(num)) return 0
  if (trimmed.endsWith("k")) return Math.round(num * 1_000)
  if (trimmed.endsWith("m")) return Math.round(num * 1_000_000)
  return Math.round(num)
}

// Mock follower count — scales with like count so "big" authors look big.
function followersFor(author: string, likes: number): string {
  if (author === "you") return "42"
  const base = Math.max(1_200, likes * 40)
  if (base >= 1_000_000) return `${(base / 1_000_000).toFixed(1)}m`
  if (base >= 1_000) return `${(base / 1_000).toFixed(0)}k`
  return String(base)
}

export { ClipCardTrigger }
