import * as React from "react"
import {
  ArrowUpDownIcon,
  HeartIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
  SendHorizontalIcon,
  SmileIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

import type { UserChipData } from "@/lib/user-display"

type Sort = "top" | "new"

export function CommentsHeader({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-center pt-4 pb-1">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised px-3 py-1 text-xs font-medium text-foreground-faint">
        <MessageSquareIcon className="size-3.5" />
        {count} {count === 1 ? "comment" : "comments"}
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
          <Button variant="ghost" size="sm" aria-label="Sort comments">
            <ArrowUpDownIcon className="size-4" />
            Sort by: {sort === "top" ? "Top" : "New"}
          </Button>
        }
      />
      <DropdownMenuContent align="start" sideOffset={6}>
        <DropdownMenuItem
          data-active={sort === "top" ? "true" : undefined}
          onClick={() => onSortChange("top")}
        >
          Top
        </DropdownMenuItem>
        <DropdownMenuItem
          data-active={sort === "new" ? "true" : undefined}
          onClick={() => onSortChange("new")}
        >
          New
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CommentComposer({
  draft,
  me,
  meAvatarStyle,
  inputRef,
  replyingToName,
  placeholder = "Add a comment…",
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
        "focus-within:border-accent-border focus-within:bg-surface-raised"
      )}
    >
      {replyingToName ? (
        <div className="flex items-center justify-between gap-2 rounded-sm bg-surface-raised px-2 py-1 text-xs text-foreground-faint">
          <span className="min-w-0 truncate">
            Replying to{" "}
            <span className="font-medium text-foreground">
              {replyingToName}
            </span>
          </span>
          {onCancelReply ? (
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label="Cancel reply"
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
          className={cn(
            "min-h-[32px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none",
            "placeholder:text-foreground-faint"
          )}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Emoji"
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
              Cancel
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
            {submitting ? "Posting…" : "Post"}
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
          isLong && !expanded && "line-clamp-4"
        )}
      >
        {body}
        {edited ? (
          <span className="ml-1 text-xs text-foreground-faint">(edited)</span>
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
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none"
          )}
        >
          {expanded ? "Show less" : "Show more"}
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
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none"
          )}
        >
          Reply
        </button>
      ) : null}

      {replyCount > 0 ? (
        <button
          type="button"
          onClick={onToggleReplies}
          aria-label={`${repliesOpen ? "Hide" : "View"} ${replyCount} ${
            replyCount === 1 ? "reply" : "replies"
          }`}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
            "text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "hover:bg-accent-soft",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none"
          )}
        >
          {compactReplies ? (
            repliesOpen ? (
              "Hide"
            ) : (
              <>
                <MessageSquareIcon className="size-3" />
                {replyCount}
              </>
            )
          ) : repliesOpen ? (
            `Hide ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`
          ) : (
            `View ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`
          )}
        </button>
      ) : null}
    </div>
  )
}

export function CommentLikeButton({
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
        "text-xs font-medium",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        liked ? "text-accent" : "text-foreground-faint hover:text-foreground",
        "hover:bg-surface-raised",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none"
      )}
    >
      <HeartIcon className={cn("size-3", liked && "fill-current")} />
      {likeCount}
    </button>
  )
}

export function AuthorLikeBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent"
      title="Liked by the clip author"
    >
      <HeartIcon className="size-3 fill-current" />
      Author
    </span>
  )
}

export function CommentMenu({
  canPin,
  canDelete,
  deletePending,
  deleteTitle,
  deleteDescription,
  deleteActionLabel,
  pinned,
  onPinToggle,
  onDelete,
}: {
  canPin: boolean
  canDelete: boolean
  deletePending: boolean
  deleteTitle: string
  deleteDescription: string
  deleteActionLabel: string
  pinned: boolean
  onPinToggle: () => void
  onDelete: () => void
}) {
  const [alertOpen, setAlertOpen] = React.useState(false)

  if (!canPin && !canDelete) return null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Comment actions"
              className="-mr-1 ml-auto"
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" sideOffset={6}>
          {canPin ? (
            <DropdownMenuItem onClick={onPinToggle}>
              {pinned ? (
                <>
                  <PinOffIcon /> Unpin
                </>
              ) : (
                <>
                  <PinIcon /> Pin
                </>
              )}
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <>
              {canPin ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setAlertOpen(true)}
              >
                <Trash2Icon /> Delete
              </DropdownMenuItem>
            </>
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
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={onDelete}
              disabled={deletePending}
            >
              {deletePending ? "Deleting…" : deleteActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
