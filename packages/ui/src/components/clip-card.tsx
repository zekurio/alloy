import * as React from "react"
import { EyeIcon, HeartIcon, MessageSquareIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Alloy ClipCard — the core browsing primitive. A rounded 16:9 thumbnail
 * with the metadata floating directly beneath it (no card container, no
 * border, no surface fill).
 *
 * Thumbnail sources:
 *   - pass `thumbnail` for a real image URL
 *   - pass `accentHue` (0–360) for a gradient placeholder tinted to the
 *     clip's game colour
 *   - neither → diagonal-stripe "clip preview" placeholder
 *
 * `comments` is optional — if omitted, it's estimated from `likes` so a
 * bare `{views, likes}` call still renders a full stats row.
 */
interface ClipCardProps extends React.ComponentProps<"article"> {
  title: string
  author: string
  game: string
  views: string
  likes: string
  comments?: string | number
  postedAt?: string
  thumbnail?: string
  accentHue?: number
}

function ClipCard({
  className,
  title,
  author,
  game,
  views,
  likes,
  comments,
  postedAt = "2h ago",
  thumbnail,
  accentHue,
  ...props
}: ClipCardProps) {
  const commentCount =
    comments ??
    Math.max(0, Math.floor((Number.parseFloat(likes) || 0) / 8))

  return (
    <article
      data-slot="clip-card"
      className={cn(
        "group/clip-card flex cursor-pointer flex-col gap-3",
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "relative aspect-video overflow-hidden rounded-md bg-neutral-200",
          "transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "group-hover/clip-card:shadow-[0_0_0_1px_var(--accent-border)]"
        )}
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={title}
            className="size-full object-cover"
          />
        ) : accentHue !== undefined ? (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, oklch(0.3 0.1 ${accentHue}) 0%, oklch(0.15 0.05 ${accentHue}) 70%, oklch(0.08 0 0) 100%)`,
            }}
          />
        ) : (
          <div
            aria-hidden
            className={cn(
              "absolute inset-0 grid place-items-center",
              "font-mono text-2xs uppercase tracking-[0.1em] text-foreground-faint"
            )}
            style={{
              background:
                "repeating-linear-gradient(45deg, oklch(0.18 0 0) 0 8px, oklch(0.16 0 0) 8px 16px)",
            }}
          >
            clip preview
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="truncate text-lg font-semibold tracking-[-0.015em] text-foreground">
          {title}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-md text-foreground-dim">
          <span className="font-medium text-foreground-muted">{author}</span>
          <span className="text-foreground-faint">·</span>
          <span className="text-accent">{game}</span>
        </div>
        <div className="flex items-center gap-4 font-mono text-sm tracking-[0.04em] text-foreground-faint">
          <span className="inline-flex items-center gap-1.5">
            <EyeIcon className="size-3.5" />
            {views}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <HeartIcon className="size-3.5" />
            {likes}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MessageSquareIcon className="size-3.5" />
            {commentCount}
          </span>
          <span className="ml-auto">{postedAt}</span>
        </div>
      </div>
    </article>
  )
}

export { ClipCard, type ClipCardProps }
