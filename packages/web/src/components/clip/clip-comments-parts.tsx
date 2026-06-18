import { COMMENT_BODY_MAX_LENGTH } from "@alloy/api"
import { t as tx, tp } from "@alloy/i18n"
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
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Button } from "@alloy/ui/components/button"
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
  SendHorizontalIcon,
  SmileIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import * as React from "react"

import { formatCount } from "@/lib/number-format"
import type { UserChipData } from "@/lib/user-display"

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
          <Button variant="ghost" size="sm" aria-label={tx("Sort comments")}>
            <ArrowUpDownIcon className="size-4" />
            {tx("Sort by:")}
            {sort === "top" ? tx("Top") : tx("New")}
          </Button>
        }
      />
      <DropdownMenuContent align="start" sideOffset={6}>
        <DropdownMenuItem
          data-active={sort === "top" ? "true" : undefined}
          onClick={() => onSortChange("top")}
        >
          {tx("Top")}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-active={sort === "new" ? "true" : undefined}
          onClick={() => onSortChange("new")}
        >
          {tx("New")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CommentAuthHint({ canSignUp }: { canSignUp: boolean }) {
  return (
    <div className="border-border bg-input rounded-md border px-3 py-2.5">
      <p className="text-foreground-faint text-sm">
        <Link
          to="/login"
          className="text-foreground font-medium hover:underline"
        >
          {tx("Log in")}
        </Link>
        {canSignUp ? (
          <>
            {tx("or")}
            <Link
              to="/sign-up"
              className="text-foreground font-medium hover:underline"
            >
              {tx("create an account")}
            </Link>
          </>
        ) : null}{" "}
        {tx("to comment")}
      </p>
    </div>
  )
}

export function CommentComposer({
  draft,
  me,
  meAvatarStyle,
  inputRef,
  replyingToName,
  placeholder = tx("Add a comment…"),
  submitting,
  canSubmit,
  onDraftChange,
  onClear,
  onCancelReply,
  onSubmit,
}: {
  draft: string
  me: UserChipData
  meAvatarStyle: { background: string; color: string }
  inputRef?: React.Ref<HTMLTextAreaElement>
  replyingToName?: string | null
  placeholder?: string
  submitting: boolean
  canSubmit: boolean
  onDraftChange: (value: string) => void
  onClear: () => void
  onCancelReply?: () => void
  onSubmit: () => void
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border bg-input p-2",
        "transition-[border-color,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "focus-within:border-accent-border focus-within:bg-surface-raised",
      )}
    >
      {replyingToName ? (
        <div className="bg-surface-raised text-foreground-faint flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-xs">
          <span className="min-w-0 truncate">
            {tx("Replying to")}{" "}
            <span className="text-foreground font-medium">
              {replyingToName}
            </span>
          </span>
          {onCancelReply ? (
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={tx("Cancel reply")}
              onClick={onCancelReply}
              disabled={submitting}
              className="size-6 shrink-0"
            >
              <XIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-start gap-2">
        <Avatar size="md" className="mt-0.5" style={meAvatarStyle}>
          {me.avatar.src ? (
            <AvatarImage src={me.avatar.src} alt={me.name} />
          ) : null}
          <AvatarFallback style={meAvatarStyle}>
            {me.avatar.initials}
          </AvatarFallback>
        </Avatar>

        <textarea
          ref={inputRef}
          data-slot="comment-input"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          rows={2}
          maxLength={COMMENT_BODY_MAX_LENGTH}
          className={cn(
            "min-h-[32px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none",
            "placeholder:text-foreground-faint",
          )}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={tx("Emoji")}
            type="button"
          >
            <SmileIcon />
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          {draft.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={onClear}
              disabled={submitting}
            >
              {tx("Cancel")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            type="button"
            disabled={!canSubmit || submitting}
            onClick={onSubmit}
          >
            <SendHorizontalIcon />
            {submitting ? tx("Posting…") : tx("Post")}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function CommentBody({
  body,
  expanded,
  isLong,
  edited,
  deleted = false,
  onToggle,
}: {
  body: string
  expanded: boolean
  isLong: boolean
  edited: boolean
  deleted?: boolean
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
        {body}
        {edited ? (
          <span className="text-foreground-faint ml-1 text-xs">
            {tx("(edited)")}
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
          {expanded ? tx("Show less") : tx("Show more")}
        </button>
      ) : null}
    </>
  )
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
          {tx("Reply")}
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
              <PinOffIcon className="size-3" /> {tx("Unpin")}
            </>
          ) : (
            <>
              <PinIcon className="size-3" /> {tx("Pin")}
            </>
          )}
        </button>
      ) : pinned ? (
        <span className="bg-accent-soft text-accent inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs leading-4 font-semibold">
          <PinIcon className="size-3" />
          {tx("Pinned by author")}
        </span>
      ) : null}

      {replyCount > 0 ? (
        <button
          type="button"
          onClick={onToggleReplies}
          aria-label={
            repliesOpen
              ? tx("Hide {count} {label}", {
                  count: replyCount,
                  label: tp(replyCount, "reply", "replies"),
                })
              : tx("View {count} {label}", {
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
              tx("Hide")
            ) : (
              <>
                <MessageSquareIcon className="size-3" />
                {formatCount(replyCount)}
              </>
            )
          ) : repliesOpen ? (
            tx("Hide {count} {label}", {
              count: formatCount(replyCount),
              label: tp(replyCount, "reply", "replies"),
            })
          ) : (
            tx("View {count} {label}", {
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
      title={tx("Liked by the clip author")}
    >
      <HeartIcon className="size-3 fill-current" />
      {tx("Author")}
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
  const [alertOpen, setAlertOpen] = React.useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={tx("Comment actions")}
              className="-mr-1 ml-auto"
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" sideOffset={6}>
          <DropdownMenuItem onClick={onCopyLink}>
            <LinkIcon /> {tx("Copy link")}
          </DropdownMenuItem>
          {canDelete ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setAlertOpen(true)}
            >
              <Trash2Icon /> {tx("Delete")}
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
              {tx("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={onDelete}
              disabled={deletePending}
            >
              {deletePending ? tx("Deleting…") : deleteActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
