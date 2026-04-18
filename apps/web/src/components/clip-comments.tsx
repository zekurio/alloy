import * as React from "react"
import {
  HeartIcon,
  MessageSquareIcon,
  SendHorizontalIcon,
  SmileIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Chip } from "@workspace/ui/components/chip"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Comments sidebar — rendered alongside the clip player.
 *
 * Layout is a simple flex column with a sticky header, a scrollable list
 * in the middle, and a composer pinned to the bottom. Each comment is a
 * flat row (no cards) to match the ClipCard aesthetic — avatar, author,
 * body, then a muted action row beneath.
 */
interface Comment {
  id: string
  author: string
  body: string
  postedAt: string
  likes: number
  pinned?: boolean
  avatar: { initials: string; bg: string; fg: string }
  replies?: number
}

const MOCK_COMMENTS: Array<Comment> = [
  {
    id: "c1",
    author: "shroud_v2",
    body: "the wall bang at 0:22 — how did you even know he was there?? teach me sensei 🙏",
    postedAt: "2h",
    likes: 214,
    pinned: true,
    replies: 12,
    avatar: {
      initials: "SH",
      bg: "oklch(0.32 0.18 300)",
      fg: "oklch(0.92 0.1 300)",
    },
  },
  {
    id: "c2",
    author: "valkyrie",
    body: "ok but the flick at 0:34 is actually unreal. frame-perfect.",
    postedAt: "1h",
    likes: 87,
    replies: 3,
    avatar: {
      initials: "VK",
      bg: "oklch(0.34 0.16 30)",
      fg: "oklch(0.95 0.08 30)",
    },
  },
  {
    id: "c3",
    author: "nightmare",
    body: "thought you were dead on the second peek lol",
    postedAt: "56m",
    likes: 42,
    avatar: {
      initials: "NM",
      bg: "oklch(0.3 0.14 145)",
      fg: "oklch(0.95 0.1 145)",
    },
  },
  {
    id: "c4",
    author: "phoenix.rise",
    body: "crosshair placement is chef's kiss. anyone know what sens they run?",
    postedAt: "44m",
    likes: 29,
    replies: 2,
    avatar: {
      initials: "PH",
      bg: "oklch(0.32 0.16 220)",
      fg: "oklch(0.95 0.08 220)",
    },
  },
  {
    id: "c5",
    author: "jettpack",
    body: "the econ round management leading up to this is the real story",
    postedAt: "31m",
    likes: 18,
    avatar: {
      initials: "JP",
      bg: "oklch(0.34 0.14 45)",
      fg: "oklch(0.95 0.08 45)",
    },
  },
  {
    id: "c6",
    author: "mintcake",
    body: "clipped and saved for later 📎",
    postedAt: "17m",
    likes: 6,
    avatar: {
      initials: "MC",
      bg: "oklch(0.34 0.14 160)",
      fg: "oklch(0.95 0.08 160)",
    },
  },
  {
    id: "c7",
    author: "longpostluna",
    body: "ok i'm going to write the entire breakdown because people keep asking — first off, the setup on A main only works because the smoke timing forces the defender to commit to a crossing angle, which is why the wallbang lands: you're not aiming at a player, you're aiming at the path their head HAS to travel through. second, the econ on the previous round matters more than anyone credits; if they full-save you can afford the op and the flex utility, and without it this exact play genuinely does not happen. third — and this is the part nobody talks about — the crosshair placement in the 4 seconds BEFORE the wallbang is already pre-aimed at the pixel, so by the time the info comes in from the teammate, it's literally just a click. https://example.com/very/long/url/that/should/also/wrap/without/blowing/out/the/layout-because-it-has-no-hyphens-anywhere-in-it",
    postedAt: "9m",
    likes: 3,
    replies: 1,
    avatar: {
      initials: "LL",
      bg: "oklch(0.32 0.16 280)",
      fg: "oklch(0.95 0.08 280)",
    },
  },
]

// Bodies longer than this get a "Show more" toggle so one megapost
// doesn't push the rest of the conversation off the screen.
const LONG_COMMENT_CHARS = 260

interface ClipCommentsProps extends React.ComponentProps<"aside"> {
  total: number
}

function ClipComments({ className, total, ...props }: ClipCommentsProps) {
  const [draft, setDraft] = React.useState("")
  const [sort, setSort] = React.useState<"top" | "new">("top")

  return (
    <aside
      data-slot="clip-comments"
      className={cn(
        "flex h-full min-h-0 flex-col border-l border-border bg-surface",
        className
      )}
      {...props}
    >
      {/* ── Header ───────────────────────────────────────────
          Right padding leaves room for the dialog's close X so it
          doesn't collide with the sort chips on smaller viewports. */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 pr-12">
        <div className="flex items-center gap-2">
          <MessageSquareIcon className="size-4 text-accent" />
          <h2 className="text-md font-semibold leading-none tracking-[-0.005em] text-foreground">
            Comments
          </h2>
          <span className="font-mono text-2xs leading-none tracking-[0.06em] text-foreground-faint">
            {total}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Chip
            data-active={sort === "top" ? "true" : undefined}
            onClick={() => setSort("top")}
          >
            Top
          </Chip>
          <Chip
            data-active={sort === "new" ? "true" : undefined}
            onClick={() => setSort("new")}
          >
            New
          </Chip>
        </div>
      </div>

      {/* ── Scroll list ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <ul className="flex flex-col">
          {MOCK_COMMENTS.map((c, i) => (
            <CommentRow key={c.id} comment={c} first={i === 0} />
          ))}
        </ul>
      </div>

      {/* ── Composer ───────────────────────────────────────── */}
      <div className="border-t border-border bg-surface-sunken p-3">
        <div
          className={cn(
            "flex flex-col gap-2 rounded-md border border-border bg-input p-2",
            "transition-[border-color,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "focus-within:border-accent-border focus-within:bg-surface-raised"
          )}
        >
          <div className="flex items-start gap-2">
            {/* "you" avatar */}
            <span
              aria-hidden
              className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-semibold"
              style={{
                background: "oklch(0.3 0.14 220)",
                color: "oklch(0.95 0.08 220)",
              }}
            >
              YO
            </span>

            <textarea
              data-slot="comment-input"
              placeholder="Add a comment…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              className={cn(
                "min-h-[32px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none",
                "placeholder:text-foreground-faint"
              )}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Emoji">
                <SmileIcon />
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              {draft.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft("")}
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                disabled={draft.trim().length === 0}
              >
                <SendHorizontalIcon />
                Post
              </Button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function CommentRow({
  comment,
  first,
}: {
  comment: Comment
  first?: boolean
}) {
  const [liked, setLiked] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const likeCount = comment.likes + (liked ? 1 : 0)
  const isLong = comment.body.length > LONG_COMMENT_CHARS

  return (
    <li
      className={cn(
        "flex gap-3 px-4 py-3",
        !first && "border-t border-border",
        comment.pinned &&
          "bg-[color-mix(in_oklab,var(--accent)_4%,transparent)]"
      )}
    >
      {/* Avatar */}
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-md text-[11px] font-semibold"
        style={{
          background: comment.avatar.bg,
          color: comment.avatar.fg,
        }}
      >
        {comment.avatar.initials}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Author row */}
        <div className="flex items-center gap-2 leading-none">
          <button
            type="button"
            className="text-sm font-semibold text-foreground hover:text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]"
          >
            {comment.author}
          </button>
          <span className="font-mono text-2xs tracking-[0.06em] text-foreground-faint">
            {comment.postedAt}
          </span>
          {comment.pinned ? (
            <span className="ml-auto font-mono text-2xs uppercase tracking-[0.12em] text-accent">
              Pinned
            </span>
          ) : null}
        </div>

        {/* Body — wraps long words/URLs and clamps very long posts */}
        <p
          className={cn(
            "text-sm leading-[1.5] text-foreground-muted",
            "whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
            isLong && !expanded && "line-clamp-4"
          )}
        >
          {comment.body}
        </p>
        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className={cn(
              "-mt-0.5 self-start rounded-md px-1.5 py-0.5",
              "font-mono text-2xs tracking-[0.04em] text-accent",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:bg-accent-soft",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            )}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}

        {/* Actions */}
        <div className="mt-0.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLiked((l) => !l)}
            aria-pressed={liked}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
              "font-mono text-2xs tracking-[0.04em]",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              liked
                ? "text-accent"
                : "text-foreground-faint hover:text-foreground",
              "hover:bg-surface-raised",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            )}
          >
            <HeartIcon
              className={cn("size-3", liked && "fill-current")}
            />
            {likeCount}
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-1.5 py-0.5 font-mono text-2xs tracking-[0.04em]",
              "text-foreground-faint transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:bg-surface-raised hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            )}
          >
            Reply
          </button>
          {comment.replies ? (
            <button
              type="button"
              className={cn(
                "rounded-md px-1.5 py-0.5 font-mono text-2xs tracking-[0.04em]",
                "text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                "hover:bg-accent-soft",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              )}
            >
              View {comment.replies} replies
            </button>
          ) : null}
        </div>
      </div>
    </li>
  )
}

export { ClipComments, type ClipCommentsProps }
