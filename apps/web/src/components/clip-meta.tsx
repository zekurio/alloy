import * as React from "react"
import {
  BookmarkIcon,
  CheckIcon,
  HeartIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  Share2Icon,
  UserPlusIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Uploader details + action bar that sits under the clip player.
 *
 * Split into three stacked rows so each chunk stays scannable at the
 * tight Alloy spacing:
 *   1. Title + posted metadata
 *   2. Uploader identity row (avatar, handle, follower count, follow button)
 *   3. Action bar (like · comment · bookmark · share · more)
 */
interface ClipMetaProps {
  title: string
  game: string
  views: string
  postedAt: string
  uploader: {
    name: string
    followers: string
    avatar: {
      initials: string
      bg?: string
      fg?: string
    }
  }
  likes: number
  comments: number
}

function ClipMeta({
  title,
  game,
  views,
  postedAt,
  uploader,
  likes,
  comments,
}: ClipMetaProps) {
  const [liked, setLiked] = React.useState(false)
  const [bookmarked, setBookmarked] = React.useState(false)
  const [following, setFollowing] = React.useState(false)

  const likeCount = likes + (liked ? 1 : 0)

  return (
    <section className="flex flex-col gap-5">
      {/* ── Row 1: Title + meta ────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="accent">{game}</Badge>
          <span className="font-mono text-2xs uppercase tracking-[0.12em] text-foreground-faint">
            Clip · {postedAt}
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
          {title}
        </h1>

        {/* ── Views + actions on one line ─────────────────────
            Views stay on the left as read-only context; interactive
            buttons sit on the right so the eye naturally reads
            info → action in a single sweep. */}
        <div className="-mx-2 flex items-center">
          <span className="px-2 font-mono text-sm tracking-[0.04em] text-foreground-faint">
            <span className="text-foreground-muted">{views}</span> views
          </span>

          <div className="ml-auto flex items-center gap-0.5">
            <Button
              variant={liked ? "accent-outline" : "ghost"}
              size="md"
              onClick={() => setLiked((l) => !l)}
              aria-pressed={liked}
            >
              <HeartIcon className={cn(liked && "fill-current")} />
              <span className="font-mono tracking-[0.04em]">
                {formatCount(likeCount)}
              </span>
            </Button>

            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                const el = document.querySelector<HTMLTextAreaElement>(
                  "[data-slot='comment-input']"
                )
                el?.focus()
              }}
            >
              <MessageSquareIcon />
              <span className="font-mono tracking-[0.04em]">
                {formatCount(comments)}
              </span>
            </Button>

            <Button
              variant={bookmarked ? "accent-outline" : "ghost"}
              size="md"
              onClick={() => setBookmarked((b) => !b)}
              aria-label="Save clip"
              aria-pressed={bookmarked}
            >
              <BookmarkIcon className={cn(bookmarked && "fill-current")} />
              {bookmarked ? "Saved" : "Save"}
            </Button>

            <Button variant="ghost" size="md">
              <Share2Icon />
              Share
            </Button>

            <Button
              variant="ghost"
              size="icon"
              aria-label="More options"
            >
              <MoreHorizontalIcon />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Row 2: Uploader identity ───────────────────────── */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3",
          "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "hover:border-border-strong"
        )}
      >
        {/* Avatar — mirrors UserChip tinted-square style at size lg */}
        <button
          type="button"
          aria-label={`Open ${uploader.name}'s profile`}
          className={cn(
            "grid size-10 shrink-0 place-items-center overflow-hidden rounded-md",
            "text-[13px] font-semibold",
            "transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          )}
          style={{
            background: uploader.avatar.bg ?? "var(--neutral-200)",
            color: uploader.avatar.fg ?? "var(--foreground)",
          }}
        >
          {uploader.avatar.initials}
        </button>

        <div className="flex min-w-0 flex-col leading-tight">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 text-md font-semibold tracking-[-0.005em] text-foreground",
              "hover:text-accent",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "focus-visible:outline-none focus-visible:text-accent"
            )}
          >
            <span>{uploader.name}</span>
          </button>
          <span className="mt-0.5 font-mono text-2xs tracking-[0.06em] text-foreground-faint">
            <span className="text-foreground-dim">{uploader.followers}</span>{" "}
            followers
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm">
            View profile
          </Button>
          <Button
            variant={following ? "secondary" : "primary"}
            size="sm"
            onClick={() => setFollowing((f) => !f)}
            aria-pressed={following}
          >
            {following ? (
              <>
                <CheckIcon />
                Following
              </>
            ) : (
              <>
                <UserPlusIcon />
                Follow
              </>
            )}
          </Button>
        </div>
      </div>

    </section>
  )
}

// 1.4k / 12.8k / 842 — mirrors the rest of Alloy's number style.
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export { ClipMeta, type ClipMetaProps }
