import { COMMENT_BODY_MAX_LENGTH } from "@alloy/api"
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
  Trash2Icon,
  XIcon,
} from "lucide-react"
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"

import { userProfileHref } from "@/lib/app-paths"
import { formatCount } from "@/lib/number-format"
import { useDebouncedValue } from "@/lib/use-debounced-value"
import type { UserChipData } from "@/lib/user-display"
import { useUserSearchQuery } from "@/lib/user-queries"

import { CommentEmojiPicker } from "./comment-emoji-picker"

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
    <div className="border-border bg-input rounded-md border px-3 py-2.5">
      <p className="text-foreground-faint text-sm">
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
    </div>
  )
}

export function CommentComposer({
  draft,
  me,
  meAvatarStyle,
  inputRef,
  replyingToName,
  placeholder = t("Add a comment…"),
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
  inputRef?: Ref<HTMLTextAreaElement>
  replyingToName?: string | null
  placeholder?: string
  submitting: boolean
  canSubmit: boolean
  onDraftChange: (value: string) => void
  onClear: () => void
  onCancelReply?: () => void
  onSubmit: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const setTextareaRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node
      if (typeof inputRef === "function") {
        inputRef(node)
        return
      }
      if (inputRef) inputRef.current = node
    },
    [inputRef],
  )
  const mentionListboxId = useId()
  const [activeMention, setActiveMention] = useState<{
    start: number
    end: number
    query: string
  } | null>(null)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const mentionQueryText = activeMention?.query ?? ""
  const debouncedMentionQuery = useDebouncedValue(mentionQueryText, 180)
  const mentionQuery = useUserSearchQuery(debouncedMentionQuery)
  const mentionSuggestions = useMemo(
    () => mentionQuery.data?.slice(0, 8) ?? [],
    [mentionQuery.data],
  )
  const activeMentionIndex =
    mentionSuggestions.length > 0
      ? Math.min(mentionActiveIndex, mentionSuggestions.length - 1)
      : 0
  const mentionListOpen =
    activeMention !== null &&
    debouncedMentionQuery === activeMention.query &&
    mentionSuggestions.length > 0
  useEffect(() => {
    setMentionActiveIndex(0)
  }, [mentionSuggestions])
  const updateActiveMention = useCallback((value: string, caret: number) => {
    const beforeCaret = value.slice(0, caret)
    const match = beforeCaret.match(/(^|\s)@([^\s@/\\]*)$/u)
    if (!match || !match[2]) {
      setActiveMention(null)
      return
    }
    setActiveMention({
      start: caret - match[2].length - 1,
      end: caret,
      query: match[2],
    })
  }, [])
  const selectMention = useCallback(
    (username: string) => {
      if (!activeMention) return
      const input = textareaRef.current
      const next = `${draft.slice(0, activeMention.start)}@${username} ${draft.slice(activeMention.end)}`
      const caret = activeMention.start + username.length + 2
      onDraftChange(next)
      setActiveMention(null)
      window.setTimeout(() => {
        input?.focus()
        input?.setSelectionRange(caret, caret)
      }, 0)
    },
    [activeMention, draft, onDraftChange],
  )
  const insertEmoji = useCallback(
    (emoji: string) => {
      const input = textareaRef.current
      if (!input) {
        onDraftChange(`${draft}${emoji}`)
        return
      }
      const start = input.selectionStart
      const end = input.selectionEnd
      const next = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`
      onDraftChange(next)
      window.setTimeout(() => {
        input.focus()
        const caret = start + emoji.length
        input.setSelectionRange(caret, caret)
      }, 0)
    },
    [draft, onDraftChange],
  )
  const onMentionKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!mentionListOpen) {
        if (event.key === "Escape" && activeMention) setActiveMention(null)
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setMentionActiveIndex(
          (index) => (index + 1) % mentionSuggestions.length,
        )
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setMentionActiveIndex(
          (index) =>
            (index - 1 + mentionSuggestions.length) % mentionSuggestions.length,
        )
        return
      }
      if (event.key === "Enter") {
        event.preventDefault()
        const user = mentionSuggestions[activeMentionIndex]
        if (user) selectMention(user.username)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setActiveMention(null)
      }
    },
    [
      activeMention,
      activeMentionIndex,
      mentionListOpen,
      mentionSuggestions,
      selectMention,
    ],
  )
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-md border border-border bg-input p-2",
        "transition-[border-color,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "focus-within:border-accent-border focus-within:bg-surface-raised",
      )}
    >
      {replyingToName ? (
        <div className="bg-surface-raised text-foreground-faint flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-xs">
          <span className="min-w-0 truncate">
            {t("Replying to")}{" "}
            <span className="text-foreground font-medium">
              {replyingToName}
            </span>
          </span>
          {onCancelReply ? (
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={t("Cancel reply")}
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
          ref={setTextareaRef}
          data-slot="comment-input"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => {
            onDraftChange(e.target.value)
            updateActiveMention(e.target.value, e.target.selectionStart)
          }}
          onClick={(e) =>
            updateActiveMention(
              e.currentTarget.value,
              e.currentTarget.selectionStart,
            )
          }
          onKeyDown={onMentionKeyDown}
          onKeyUp={(e) => {
            if (e.key === "Escape" || e.key === " ") {
              setActiveMention(null)
              return
            }
            if (
              e.key === "ArrowDown" ||
              e.key === "ArrowUp" ||
              e.key === "Enter"
            ) {
              return
            }
            updateActiveMention(
              e.currentTarget.value,
              e.currentTarget.selectionStart,
            )
          }}
          onBlur={() => window.setTimeout(() => setActiveMention(null), 120)}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={mentionListOpen}
          aria-controls={mentionListOpen ? mentionListboxId : undefined}
          aria-activedescendant={
            mentionListOpen
              ? `${mentionListboxId}-option-${activeMentionIndex}`
              : undefined
          }
          rows={2}
          maxLength={COMMENT_BODY_MAX_LENGTH}
          className={cn(
            "min-h-[32px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none",
            "placeholder:text-foreground-faint",
          )}
        />
      </div>
      {mentionListOpen ? (
        <div
          id={mentionListboxId}
          role="listbox"
          className="border-border bg-popover absolute top-full left-12 z-20 mt-1 max-h-56 w-64 overflow-y-auto rounded-md border p-1 shadow-md"
        >
          {mentionSuggestions.map((user, index) => (
            <button
              id={`${mentionListboxId}-option-${index}`}
              key={user.id}
              type="button"
              role="option"
              aria-selected={index === activeMentionIndex}
              className={cn(
                "hover:bg-surface-raised flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                index === activeMentionIndex ? "bg-surface-raised" : null,
              )}
              onMouseDown={(event) => {
                event.preventDefault()
                selectMention(user.username)
              }}
            >
              <span className="min-w-0 flex-1 truncate">{user.username}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <CommentEmojiPicker onSelect={insertEmoji} />
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
              {t("Cancel")}
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
            {submitting ? t("Posting…") : t("Post")}
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
