import type { GameRow, UserSearchResult } from "@alloy/api"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Chip } from "@alloy/ui/components/chip"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { Textarea } from "@alloy/ui/components/textarea"
import { cn } from "@alloy/ui/lib/utils"
import {
  AtSignIcon,
  ChevronRightIcon,
  Gamepad2Icon,
  HashIcon,
  XIcon,
} from "lucide-react"
import * as React from "react"

import { GameCombobox } from "@/components/game/game-combobox"
import { useSession } from "@/lib/auth-client"
import {
  CLIP_DESCRIPTION_MAX,
  CLIP_TITLE_MAX,
  sanitizeTag,
} from "@/lib/clip-fields"
import { useTagSearchQuery } from "@/lib/tag-queries"
import { useDebouncedValue } from "@/lib/use-debounced-value"
import { userChipData } from "@/lib/user-display"
import { useUserSearchQuery } from "@/lib/user-queries"

const INLINE_PICKER_INPUT_CLASS = cn(
  "h-8! rounded-lg bg-surface-raised text-sm leading-4 font-semibold sm:h-8!",
  "[&_[data-slot=input-group-addon]]:py-0",
  "[&_[data-slot=input-group-addon][data-align=inline-start]]:pl-2.5",
  "[&_[data-slot=input-group-control]]:text-sm",
  "[&_[data-slot=input-group-control]]:font-semibold",
  "[&_[data-slot=input-group-control]]:pl-2!",
  "[&_[data-slot=input-group-control]]:-translate-y-px",
  "[&_[data-slot=input-group-control]]:placeholder:font-semibold",
  "[&_[data-slot=input-group-control]]:placeholder:text-foreground-muted",
  "[&_svg:not([class*='size-'])]:size-4",
)

interface ClipMetadataEditorProps {
  title: string
  onTitleChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
  game: GameRow | null
  onGameChange: (game: GameRow | null) => void
  mentions: UserSearchResult[]
  onMentionsChange: (mentions: UserSearchResult[]) => void
  /** Bare hashtags ("ace", "ranked"). Omit to hide the Hashtags row. */
  tags?: string[]
  onTagsChange?: (tags: string[]) => void
  disabled?: boolean
  /** Surface validation after a submit attempt. */
  titleInvalid?: boolean
  gameInvalid?: boolean
  autoFocusGame?: boolean
}

export function ClipMetadataEditor({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  game,
  onGameChange,
  mentions,
  onMentionsChange,
  tags,
  onTagsChange,
  disabled = false,
  titleInvalid = false,
  gameInvalid = false,
  autoFocusGame = false,
}: ClipMetadataEditorProps) {
  const showTags = tags !== undefined && onTagsChange !== undefined

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        maxLength={CLIP_TITLE_MAX}
        disabled={disabled}
        placeholder="Untitled"
        aria-label="Title"
        aria-invalid={titleInvalid || undefined}
        className={cn(
          "w-full border-b border-transparent bg-transparent pb-1.5 text-lg font-semibold text-foreground",
          "outline-none transition-colors placeholder:text-foreground-faint",
          "focus-visible:border-border-strong",
          titleInvalid &&
            "border-destructive placeholder:text-destructive/60 focus-visible:border-destructive",
          disabled && "opacity-60",
        )}
      />

      <Textarea
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        maxLength={CLIP_DESCRIPTION_MAX}
        disabled={disabled}
        rows={2}
        placeholder="Add a description…"
        className={cn(
          "min-h-0 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-sm leading-relaxed",
          "hover:border-0 hover:bg-transparent focus-visible:border-0 focus-visible:bg-transparent focus-visible:ring-0",
        )}
      />

      <ClipMetadataSection label="Game">
        <GamePickerChip
          value={game}
          onChange={onGameChange}
          disabled={disabled}
          invalid={gameInvalid}
          promptOnMount={autoFocusGame}
        />
      </ClipMetadataSection>

      <ClipMetadataSection label="People">
        <PeoplePicker
          value={mentions}
          onChange={onMentionsChange}
          disabled={disabled}
        />
      </ClipMetadataSection>

      {showTags ? (
        <ClipMetadataSection label="Hashtags">
          <HashtagPicker
            value={tags}
            onChange={onTagsChange}
            disabled={disabled}
          />
        </ClipMetadataSection>
      ) : null}
    </div>
  )
}

export function ClipMetadataSection({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-foreground-muted text-xs font-semibold">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

function GamePickerChip({
  value,
  onChange,
  disabled,
  invalid,
  promptOnMount,
}: {
  value: GameRow | null
  onChange: (game: GameRow | null) => void
  disabled: boolean
  invalid: boolean
  promptOnMount: boolean
}) {
  const [editing, setEditing] = React.useState(false)
  const autoFocusUsedRef = React.useRef(false)
  const rootRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (autoFocusUsedRef.current || disabled || !promptOnMount || value) return
    autoFocusUsedRef.current = true
    setEditing(true)
  }, [disabled, promptOnMount, value])

  useOutsideDismiss(
    rootRef,
    editing,
    () => setEditing(false),
    (target) => target.closest("[data-slot=combobox-content]") !== null,
  )

  if (editing) {
    return (
      <div ref={rootRef} className="w-56 max-w-full">
        <GameCombobox
          value={value}
          onChange={(next) => {
            if (!next) return
            onChange(next)
            setEditing(false)
          }}
          disabled={disabled}
          invalid={invalid && !value}
          placeholder="Search game..."
          allowClear={false}
          focusOnMount
          className="w-full"
          inputClassName={INLINE_PICKER_INPUT_CLASS}
        />
      </div>
    )
  }

  return (
    <div ref={rootRef} className="w-56 max-w-full">
      <Chip
        size="xl"
        disabled={disabled}
        data-active={value ? "true" : undefined}
        onClick={() => {
          setEditing(true)
        }}
        className={cn(
          "w-full max-w-full justify-start",
          invalid &&
            !value &&
            "border-destructive text-destructive hover:border-destructive hover:text-destructive",
        )}
      >
        {value ? (
          <>
            <GameIcon src={value.iconUrl ?? value.logoUrl} name={value.name} />
            <span className="min-w-0 flex-1 truncate text-left">
              {value.name}
            </span>
          </>
        ) : (
          <>
            <Gamepad2Icon />
            <span className="min-w-0 flex-1 truncate text-left">Add game</span>
          </>
        )}
        <ChevronRightIcon className="text-foreground-faint" />
      </Chip>
    </div>
  )
}

function useOutsideDismiss<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  enabled: boolean,
  onDismiss: () => void,
  ignoreTarget?: (target: Element) => boolean,
) {
  React.useEffect(() => {
    if (!enabled) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (ref.current?.contains(target)) return
      if (ignoreTarget?.(target)) return
      onDismiss()
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [enabled, ignoreTarget, onDismiss, ref])
}

/**
 * Shared scaffolding for inline picker fields: draft text, debounced query,
 * focus on open, and restoration to the original chip when focus leaves.
 */
function useInlinePicker() {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const debouncedDraft = useDebouncedValue(draft, 200)

  const close = React.useCallback(() => {
    setOpen(false)
    setDraft("")
  }, [])

  useOutsideDismiss(rootRef, open, close)

  React.useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  return {
    open,
    draft,
    debouncedDraft,
    setDraft,
    setOpen,
    inputRef,
    rootRef,
  }
}

function PickerChipTrigger({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Chip
      size="xl"
      disabled={disabled}
      onClick={onClick}
      className="w-full justify-start"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <ChevronRightIcon className="text-foreground-faint" />
    </Chip>
  )
}

type PickerInputShellProps = {
  icon: React.ReactNode
  value: string
  onChange: (value: string) => void
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  inputRef: React.Ref<HTMLInputElement>
  placeholder: string
  disabled: boolean
  label: string
  completion?: string | null
} & Omit<React.ComponentPropsWithoutRef<"span">, "onChange" | "onKeyDown">

const PickerInputShell = React.forwardRef<
  HTMLSpanElement,
  PickerInputShellProps
>(function PickerInputShell(
  {
    icon,
    value,
    onChange,
    onKeyDown,
    inputRef,
    placeholder,
    disabled,
    label,
    completion,
    className,
    ...props
  },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-surface-raised px-2.5 text-sm leading-4 font-semibold text-foreground",
        "focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-border/20",
        "[&_svg:not([class*='size-'])]:size-4",
        disabled && "opacity-60",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="relative min-w-0 flex-1">
        {completion ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden font-semibold whitespace-pre"
          >
            <span className="invisible">{value}</span>
            <span className="text-foreground-faint">
              {completionTail(value, completion)}
            </span>
          </span>
        ) : null}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={label}
          className="placeholder:text-foreground-muted relative z-10 w-full bg-transparent text-sm leading-4 font-semibold outline-none placeholder:font-semibold"
        />
      </span>
    </span>
  )
})

function completionTail(value: string, completion: string): string {
  if (!value) return completion
  if (!completion.toLowerCase().startsWith(value.toLowerCase())) return ""
  return completion.slice(value.length)
}

function PeoplePicker({
  value,
  onChange,
  disabled,
}: {
  value: UserSearchResult[]
  onChange: (next: UserSearchResult[]) => void
  disabled: boolean
}) {
  const selectedIds = React.useMemo(
    () => new Set(value.map((u) => u.id)),
    [value],
  )

  return (
    <>
      {value.map((user) => (
        <PersonChip
          key={user.id}
          user={user}
          disabled={disabled}
          onRemove={() => onChange(value.filter((u) => u.id !== user.id))}
        />
      ))}
      <PeopleSearchPopover
        selectedIds={selectedIds}
        disabled={disabled}
        onPick={(user) => onChange([...value, user])}
      />
    </>
  )
}

function PersonChip({
  user,
  onRemove,
  disabled,
}: {
  user: UserSearchResult
  onRemove: () => void
  disabled: boolean
}) {
  const chip = userChipData(user)

  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-raised py-0.5 pr-1.5 pl-1 text-sm text-foreground",
        disabled && "opacity-60",
      )}
    >
      <Avatar size="sm">
        {chip.avatar.src ? (
          <AvatarImage src={chip.avatar.src} alt={chip.name} />
        ) : null}
        <AvatarFallback
          style={{ backgroundColor: chip.avatar.bg, color: chip.avatar.fg }}
        >
          {chip.avatar.initials}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-[10rem] min-w-0 truncate font-medium">
        {chip.name}
      </span>
      <button
        type="button"
        aria-label={`Remove ${chip.name}`}
        onClick={onRemove}
        disabled={disabled}
        className="text-foreground-faint hover:text-foreground transition-colors"
      >
        <XIcon className="size-3.5" />
      </button>
    </span>
  )
}

function PeopleSearchPopover({
  selectedIds,
  onPick,
  disabled,
}: {
  selectedIds: Set<string>
  onPick: (user: UserSearchResult) => void
  disabled: boolean
}) {
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? null
  const { open, draft, debouncedDraft, setDraft, setOpen, inputRef, rootRef } =
    useInlinePicker()
  const searchQuery = useUserSearchQuery(debouncedDraft)

  const candidates = React.useMemo(() => {
    const rows = searchQuery.data ?? []
    return rows.filter((row) => !selectedIds.has(row.id) && row.id !== viewerId)
  }, [searchQuery.data, selectedIds, viewerId])

  const trimmed = debouncedDraft.trim()
  const isSearching = searchQuery.isFetching && trimmed.length > 0
  const suggestion = candidates[0] ?? null
  const suggestionChip = suggestion ? userChipData(suggestion) : null

  const acceptSuggestion = () => {
    if (!suggestion) return
    onPick(suggestion)
    setDraft("")
    inputRef.current?.focus()
  }

  return (
    <div ref={rootRef} className="relative w-36">
      {open ? (
        <PickerInputShell
          icon={<AtSignIcon className="text-foreground-muted size-4" />}
          value={draft}
          onChange={setDraft}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" ||
              event.key === "Tab" ||
              event.key === "ArrowRight"
            ) {
              if (suggestion) {
                event.preventDefault()
                acceptSuggestion()
              }
            } else if (event.key === "Escape") {
              event.preventDefault()
              setOpen(false)
              setDraft("")
            }
          }}
          inputRef={inputRef}
          placeholder="Search people..."
          disabled={disabled}
          label="Search people"
          completion={suggestionChip?.name ?? null}
          title={
            suggestionChip
              ? `Press Enter to add ${suggestionChip.name}`
              : isSearching || trimmed.length > 0
                ? "No inline match"
                : undefined
          }
        />
      ) : (
        <PickerChipTrigger
          icon={<AtSignIcon />}
          label="Tag people"
          disabled={disabled}
          onClick={() => setOpen(true)}
        />
      )}
    </div>
  )
}

function HashtagPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  disabled: boolean
}) {
  return (
    <>
      {value.map((tag) => (
        <span
          key={tag}
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface-raised px-2.5 text-sm text-foreground",
            disabled && "opacity-60",
          )}
        >
          #{tag}
          <button
            type="button"
            aria-label={`Remove #${tag}`}
            onClick={() => onChange(value.filter((t) => t !== tag))}
            disabled={disabled}
            className="text-foreground-faint hover:text-foreground transition-colors"
          >
            <XIcon className="size-3.5" />
          </button>
        </span>
      ))}
      <HashtagInputPopover
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </>
  )
}

function HashtagInputPopover({
  value,
  onChange,
  disabled,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  disabled: boolean
}) {
  const { open, draft, debouncedDraft, setDraft, setOpen, inputRef, rootRef } =
    useInlinePicker()
  const searchQuery = useTagSearchQuery(debouncedDraft)

  const commit = (raw: string) => {
    const tag = sanitizeTag(raw)
    setDraft("")
    inputRef.current?.focus()
    if (!tag) return
    if (value.includes(tag)) return
    onChange([...value, tag])
  }

  // Suggestions are tags already in use elsewhere; drop the ones this clip
  // already carries (tags are lowercase-canonical, so a plain compare works).
  const selected = React.useMemo(() => new Set(value), [value])
  const suggestions = React.useMemo(
    () => (searchQuery.data ?? []).filter((tag) => !selected.has(tag)),
    [searchQuery.data, selected],
  )
  const suggestion = suggestions[0] ?? null

  return (
    <div ref={rootRef} className="relative w-40">
      {open ? (
        <PickerInputShell
          icon={<HashIcon className="text-foreground-muted size-4" />}
          value={draft}
          onChange={(next) => setDraft(sanitizeTag(next))}
          onKeyDown={(e) => {
            if (
              e.key === "Tab" ||
              e.key === "ArrowRight" ||
              (e.key === "Enter" && suggestion)
            ) {
              e.preventDefault()
              if (suggestion) commit(suggestion)
            } else if (e.key === "Enter" || e.key === " " || e.key === ",") {
              e.preventDefault()
              commit(draft)
            } else if (
              e.key === "Backspace" &&
              draft === "" &&
              value.length > 0
            ) {
              onChange(value.slice(0, -1))
            } else if (e.key === "Escape") {
              e.preventDefault()
              setOpen(false)
              setDraft("")
            }
          }}
          inputRef={inputRef}
          placeholder="Add hashtag..."
          disabled={disabled}
          label="Add hashtag"
          completion={suggestion}
          title={
            suggestion
              ? `Press Enter to add #${suggestion}`
              : "Type a tag and press Enter"
          }
        />
      ) : (
        <PickerChipTrigger
          icon={<HashIcon />}
          label="Add hashtag"
          disabled={disabled}
          onClick={() => setOpen(true)}
        />
      )}
    </div>
  )
}
