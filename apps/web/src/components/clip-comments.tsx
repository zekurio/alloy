import * as React from "react"
import {
  HeartIcon,
  MessageSquareIcon,
  SendHorizontalIcon,
  SmileIcon,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import { Chip } from "@workspace/ui/components/chip"
import { cn } from "@workspace/ui/lib/utils"

import { useSession } from "../lib/auth-client"
import { userChipData } from "../lib/user-display"
import { EmptyState } from "./empty-state"

/**
 * Comments sidebar — rendered alongside the clip player.
 *
 * Layout is a simple flex column with a sticky header, a scrollable list
 * in the middle, and a composer pinned to the bottom. Each comment is a
 * flat row (no cards) to match the ClipCard aesthetic.
 *
 * Comments aren't wired up server-side yet — the `clip.commentCount`
 * column exists but there's no `/api/clips/:id/comments` endpoint. For
 * now the list is always empty and the composer is disabled with a
 * kaomoji empty state taking its place. Once the endpoint lands we'll
 * fetch on open, seeding `comments` with real data.
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

// Bodies longer than this get a "Show more" toggle so one megapost
// doesn't push the rest of the conversation off the screen.
const LONG_COMMENT_CHARS = 260

interface ClipCommentsProps extends React.ComponentProps<"aside"> {
  /** Seeds the kaomoji so it stays stable across re-renders of this dialog. */
  clipId: string
}

function ClipComments({ className, clipId, ...props }: ClipCommentsProps) {
  const [draft, setDraft] = React.useState("")
  const [sort, setSort] = React.useState<"top" | "new">("top")
  const { data: session } = useSession()
  const me = userChipData(session?.user)
  const meAvatarStyle = {
    background: me.avatar.bg,
    color: me.avatar.fg,
  } as const

  // Placeholder for a future `/api/clips/:id/comments` fetch. Kept as
  // component state so the empty branch is shaped the same way the
  // populated one will be.
  const comments: ReadonlyArray<Comment> = React.useMemo(() => [], [])

  const isEmpty = comments.length === 0

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
          <h2 className="text-md leading-none font-semibold tracking-[-0.005em] text-foreground">
            Comments
          </h2>
          <span className="font-mono text-2xs leading-none tracking-[0.06em] text-foreground-faint">
            {comments.length}
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
        {isEmpty ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              // Seed keeps the kaomoji stable between tab switches inside
              // the same dialog instance. Different clip ids reroll the face.
              seed={`comments-${clipId}`}
              size="lg"
              title="No comments yet"
              hint="Be the first — the composer's below."
            />
          </div>
        ) : (
          <ul className="flex flex-col">
            {comments.map((c, i) => (
              <CommentRow key={c.id} comment={c} first={i === 0} />
            ))}
          </ul>
        )}
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
            {/* Current viewer's avatar — falls back to tinted initials
                when they haven't uploaded an image yet. */}
            <Avatar size="md" className="mt-0.5" style={meAvatarStyle}>
              {me.avatar.src ? (
                <AvatarImage src={me.avatar.src} alt={me.name} />
              ) : null}
              <AvatarFallback style={meAvatarStyle}>
                {me.avatar.initials}
              </AvatarFallback>
            </Avatar>

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
                <Button variant="ghost" size="sm" onClick={() => setDraft("")}>
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

function CommentRow({ comment, first }: { comment: Comment; first?: boolean }) {
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
            className="text-sm font-semibold text-foreground transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-accent"
          >
            {comment.author}
          </button>
          <span className="font-mono text-2xs tracking-[0.06em] text-foreground-faint">
            {comment.postedAt}
          </span>
          {comment.pinned ? (
            <span className="ml-auto font-mono text-2xs tracking-[0.12em] text-accent uppercase">
              Pinned
            </span>
          ) : null}
        </div>

        {/* Body — wraps long words/URLs and clamps very long posts */}
        <p
          className={cn(
            "text-sm leading-[1.5] text-foreground-muted",
            "[overflow-wrap:anywhere] break-words whitespace-pre-wrap",
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
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none"
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
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none"
            )}
          >
            <HeartIcon className={cn("size-3", liked && "fill-current")} />
            {likeCount}
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-1.5 py-0.5 font-mono text-2xs tracking-[0.04em]",
              "text-foreground-faint transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:bg-surface-raised hover:text-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none"
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
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none"
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
