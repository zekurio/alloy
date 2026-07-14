import { COMMENT_BODY_MAX_LENGTH } from "@alloy/api"
import { t } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import { SendHorizontalIcon, XIcon } from "lucide-react"
import {
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"

import { useDebouncedValue } from "@/lib/use-debounced-value"
import type { UserChipData } from "@/lib/user-display"
import { useUserSearchQuery } from "@/lib/user-queries"

import { CommentEmojiPicker } from "./comment-emoji-picker"

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
