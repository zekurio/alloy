import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import { EMPTY_STATE_KAOMOJI } from "../lib/kaomoji"

/**
 * Empty-state block used by any surface that might come up with no rows —
 * comments, a recent-clips feed before the first upload, the search
 * results page, etc.
 *
 * Visual: oversized kaomoji on top, muted title, optional hint underneath.
 * The kaomoji rotates through a curated sad-face set each render so the
 * page doesn't read as the same copy every time. Picking a `seed`
 * (e.g. the clip id or section name) pins a given mount to one face so
 * it doesn't flicker between re-renders.
 */

function hashSeed(seed: string | number): number {
  const s = typeof seed === "number" ? String(seed) : seed
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h
}

export function pickKaomoji(seed?: string | number): string {
  // Undefined seed → pick at random on each call. Used for stateless
  // one-shots; most callers should pass a stable seed so re-renders
  // don't rotate the face.
  const idx =
    seed === undefined
      ? Math.floor(Math.random() * EMPTY_STATE_KAOMOJI.length)
      : hashSeed(seed) % EMPTY_STATE_KAOMOJI.length
  return EMPTY_STATE_KAOMOJI[idx]!
}

interface EmptyStateProps extends React.ComponentProps<"div"> {
  /**
   * Stable seed so the same mount keeps the same kaomoji across
   * re-renders. A section id or the page path works well; omit to
   * randomise each render.
   */
  seed?: string | number
  title: string
  hint?: React.ReactNode
  /** Optional trailing action node (button, link). */
  action?: React.ReactNode
  /**
   * Height hint — `md` fits inline above a form, `lg` fills a section
   * where the feed would otherwise sit. `sm` is compact for inline
   * rails.
   */
  size?: "sm" | "md" | "lg"
}

const sizeClasses: Record<NonNullable<EmptyStateProps["size"]>, string> = {
  sm: "py-8",
  md: "py-12",
  lg: "py-20",
}

const faceSizeClasses: Record<NonNullable<EmptyStateProps["size"]>, string> = {
  sm: "text-2xl",
  md: "text-4xl",
  lg: "text-5xl",
}

export function EmptyState({
  seed,
  title,
  hint,
  action,
  size = "md",
  className,
  ...props
}: EmptyStateProps) {
  // Freeze the kaomoji choice for the lifetime of this mount. Without
  // the memo, a parent re-render would reseed `Math.random()` and flip
  // the face mid-view. Seed-based picks are already deterministic but
  // paying a single `useMemo` keeps the call sites symmetric.
  const face = React.useMemo(() => pickKaomoji(seed), [seed])

  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-md",
        "text-center",
        sizeClasses[size],
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "font-mono leading-none text-foreground-faint select-none",
          faceSizeClasses[size]
        )}
      >
        {face}
      </span>
      <div className="flex flex-col gap-1 px-6">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {hint ? <p className="text-sm text-foreground-dim">{hint}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
