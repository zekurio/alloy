import { MENTION_PATTERN } from "@alloy/contracts"
import { t, tp } from "@alloy/i18n"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alloy/ui/components/alert-dialog"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import {
  ArrowUpDownIcon,
  HeartIcon,
  LinkIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from "lucide-react"
import { type ReactNode, useState } from "react"

import { userProfileHref } from "@/lib/app-paths"
import { formatCount } from "@/lib/number-format"

export { CommentComposer } from "./clip-comment-composer"

type Sort = "top" | "new"

export function CommentsHeader({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-center pt-4 pb-1">
      <div className="bg-surface-raised text-foreground-faint inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs leading-4 font-medium tabular-nums">
        <MessageSquareIcon className="size-3.5" />
        {formatCount(count)} {tp(count, "comment", "comments")}
      </div>
    </div>
  )
}

export function CommentsSortDropdown({
  sort,
  onSortChange,
}: {
  sort: Sort
  onSortChange: (next: Sort) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" aria-label={t("Sort comments")}>
            <ArrowUpDownIcon className="size-4" />
            {t("Sort by:")}
            {sort === "top" ? t("Top") : t("New")}
          </Button>
        }
      />
      <DropdownMenuContent align="start" sideOffset={6}>
        <DropdownMenuItem
          data-active={sort === "top" ? "true" : undefined}
          onClick={() => onSortChange("top")}
        >
          {t("Top")}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-active={sort === "new" ? "true" : undefined}
          onClick={() => onSortChange("new")}
        >
          {t("New")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CommentAuthHint({ canSignUp }: { canSignUp: boolean }) {
  return (
    <Callout tone="neutral">
      <p className="text-sm">
        <Link
          to="/login"
          className="text-foreground font-medium hover:underline"
        >
          {t("Log in")}
        </Link>
        {canSignUp ? (
          <>
            {t("or")}
            <Link
              to="/sign-up"
              className="text-foreground font-medium hover:underline"
            >
              {t("create an account")}
            </Link>
          </>
        ) : null}{" "}
        {t("to comment")}
      </p>
    </Callout>
  )
}

export function CommentBody({
  body,
  expanded,
  isLong,
  edited,
  deleted = false,
  mentions = [],
  onToggle,
}: {
  body: string
  expanded: boolean
  isLong: boolean
  edited: boolean
  deleted?: boolean
  mentions?: string[]
  onToggle: () => void
}) {
  return (
    <>
      <p
        className={cn(
          "text-[0.9375rem] leading-[1.55] text-foreground-muted",
          "[overflow-wrap:anywhere] break-words whitespace-pre-wrap",
          deleted && "text-foreground-faint italic",
          isLong && !expanded && "line-clamp-4",
        )}
      >
        {renderMentionTokens(body, mentions)}
        {edited ? (
          <span className="text-foreground-faint ml-1 text-xs">
            {t("(edited)")}
          </span>
        ) : null}
      </p>
      {isLong ? (
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "-mt-0.5 self-start rounded-md px-1.5 py-0.5",
            "text-xs font-medium text-accent",
            "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "hover:bg-accent-soft",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
          )}
        >
          {expanded ? t("Show less") : t("Show more")}
        </button>
      ) : null}
    </>
  )
}

function renderMentionTokens(body: string, mentions: string[]) {
  if (mentions.length === 0) return body
  const mentionSet = new Set(mentions.map((mention) => mention.toLowerCase()))
  const parts: ReactNode[] = []
  let offset = 0
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const rawUsername = match[1]
    if (!rawUsername) continue
    const atOffset = match[0].lastIndexOf("@")
    const start = (match.index ?? 0) + atOffset
    const trailingPunctuation = rawUsername.match(/[.,!?;:)\]}]+$/u)?.[0] ?? ""
    const username = trailingPunctuation
      ? rawUsername.slice(0, -trailingPunctuation.length)
      : rawUsername
    if (!mentionSet.has(username.toLowerCase())) continue
    if (start > offset) parts.push(body.slice(offset, start))
    parts.push(
      <Link
        key={`${start}:${username}`}
        to={userProfileHref(username)}
        className="text-accent font-medium hover:underline"
      >
        @{username}
      </Link>,
    )
    if (trailingPunctuation) parts.push(trailingPunctuation)
    offset = start + 1 + rawUsername.length
  }
  if (offset === 0) return body
  if (offset < body.length) parts.push(body.slice(offset))
  return parts
}

export function CommentActions({
  liked,
  likeCount,
  likedByAuthor,
  replyCount,
  repliesOpen,
  canReply,
  showLike = true,
  compactReplies = false,
  pinned,
  canPin,
  onPinToggle,
  onToggleLike,
  onToggleReplies,
  onStartReply,
}: {
  liked: boolean
  likeCount: number
  likedByAuthor: boolean
  replyCount: number
  repliesOpen: boolean
  canReply: boolean
  showLike?: boolean
  compactReplies?: boolean
  pinned: boolean
  canPin: boolean
  onPinToggle: () => void
  onToggleLike: () => void
  onToggleReplies: () => void
  onStartReply: () => void
}) {
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {showLike ? (
        <CommentLikeButton
          liked={liked}
          likeCount={likeCount}
          onClick={onToggleLike}
        />
      ) : null}

      {showLike && likedByAuthor ? <AuthorLikeBadge /> : null}

      {canReply ? (
        <button
          type="button"
          onClick={onStartReply}
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
            "text-foreground-faint transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "hover:bg-surface-raised hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
          )}
        >
          {t("Reply")}
        </button>
      ) : null}

      {canPin ? (
        <button
          type="button"
          onClick={onPinToggle}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs leading-4 font-medium whitespace-nowrap tabular-nums",
            "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            pinned
              ? "text-accent hover:bg-accent-soft"
              : "text-foreground-faint hover:bg-surface-raised hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
          )}
        >
          {pinned ? (
            <>
              <PinOffIcon className="size-3" /> {t("Unpin")}
            </>
          ) : (
            <>
              <PinIcon className="size-3" /> {t("Pin")}
            </>
          )}
        </button>
      ) : pinned ? (
        <span className="bg-accent-soft text-accent inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs leading-4 font-semibold">
          <PinIcon className="size-3" />
          {t("Pinned by author")}
        </span>
      ) : null}

      {replyCount > 0 ? (
        <button
          type="button"
          onClick={onToggleReplies}
          aria-label={
            repliesOpen
              ? t("Hide {count} {label}", {
                  count: replyCount,
                  label: tp(replyCount, "reply", "replies"),
                })
              : t("View {count} {label}", {
                  count: replyCount,
                  label: tp(replyCount, "reply", "replies"),
                })
          }
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs leading-4 font-medium whitespace-nowrap tabular-nums",
            "text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "hover:bg-accent-soft",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
          )}
        >
          {compactReplies ? (
            repliesOpen ? (
              t("Hide")
            ) : (
              <>
                <MessageSquareIcon className="size-3" />
                {formatCount(replyCount)}
              </>
            )
          ) : repliesOpen ? (
            t("Hide {count} {label}", {
              count: formatCount(replyCount),
              label: tp(replyCount, "reply", "replies"),
            })
          ) : (
            t("View {count} {label}", {
              count: formatCount(replyCount),
              label: tp(replyCount, "reply", "replies"),
            })
          )}
        </button>
      ) : null}
    </div>
  )
}

function CommentLikeButton({
  liked,
  likeCount,
  onClick,
}: {
  liked: boolean
  likeCount: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={liked}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
        "text-xs leading-4 font-medium tabular-nums",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        liked ? "text-accent" : "text-foreground-faint hover:text-foreground",
        "hover:bg-surface-raised",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
      )}
    >
      <HeartIcon className={cn("size-3", liked && "fill-current")} />
      {formatCount(likeCount)}
    </button>
  )
}

function AuthorLikeBadge() {
  return (
    <span
      className="bg-accent-soft text-accent inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs leading-4 font-semibold"
      title={t("Liked by the clip author")}
    >
      <HeartIcon className="size-3 fill-current" />
      {t("Author")}
    </span>
  )
}

export function CommentMenu({
  canDelete,
  deletePending,
  deleteTitle,
  deleteDescription,
  deleteActionLabel,
  onCopyLink,
  onDelete,
}: {
  canDelete: boolean
  deletePending: boolean
  deleteTitle: string
  deleteDescription: string
  deleteActionLabel: string
  onCopyLink: () => void
  onDelete: () => void
}) {
  const [alertOpen, setAlertOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Comment actions")}
              className="-mr-1 ml-auto"
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" sideOffset={6}>
          <DropdownMenuItem onClick={onCopyLink}>
            <LinkIcon /> {t("Copy link")}
          </DropdownMenuItem>
          {canDelete ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setAlertOpen(true)}
            >
              <Trash2Icon /> {t("Delete")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={onDelete}
              disabled={deletePending}
            >
              {deletePending ? t("Deleting…") : deleteActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
