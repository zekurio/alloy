import type { ClipPrivacy, GameRow, UserSearchResult } from "alloy-api"
import { Avatar, AvatarFallback, AvatarImage } from "alloy-ui/components/avatar"
import { Chip } from "alloy-ui/components/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "alloy-ui/components/dropdown-menu"
import { GameIcon } from "alloy-ui/components/game-icon"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "alloy-ui/components/popover"
import { Textarea } from "alloy-ui/components/textarea"
import { cn } from "alloy-ui/lib/utils"
import {
  AtSignIcon,
  ChevronDownIcon,
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
  PRIVACY_BY_VALUE,
  PRIVACY_OPTIONS,
  sanitizeTag,
} from "@/lib/clip-fields"
import { useTagSearchQuery } from "@/lib/tag-queries"
import { useDebouncedValue } from "@/lib/use-debounced-value"
import { userChipData } from "@/lib/user-display"
import { useUserSearchQuery } from "@/lib/user-queries"

interface ClipMetadataEditorProps {
  title: string
  onTitleChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
  game: GameRow | null
  onGameChange: (game: GameRow | null) => void
  mentions: UserSearchResult[]
  onMentionsChange: (mentions: UserSearchResult[]) => void
  privacy: ClipPrivacy
  onPrivacyChange: (privacy: ClipPrivacy) => void
  /** Bare hashtags ("ace", "ranked"). Omit to hide the Hashtags row. */
  tags?: string[]
  onTagsChange?: (tags: string[]) => void
  disabled?: boolean
  /** Surface validation after a submit attempt. */
  titleInvalid?: boolean
  gameInvalid?: boolean
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
  privacy,
  onPrivacyChange,
  tags,
  onTagsChange,
  disabled = false,
  titleInvalid = false,
  gameInvalid = false,
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

      <Section label="Game">
        <GamePickerChip
          value={game}
          onChange={onGameChange}
          disabled={disabled}
          invalid={gameInvalid}
        />
      </Section>

      <Section label="People">
        <PeoplePicker
          value={mentions}
          onChange={onMentionsChange}
          disabled={disabled}
        />
      </Section>

      {showTags ? (
        <Section label="Hashtags">
          <HashtagPicker
            value={tags}
            onChange={onTagsChange}
            disabled={disabled}
          />
        </Section>
      ) : null}

      <Section label="Visibility">
        <VisibilityPickerChip
          value={privacy}
          onChange={onPrivacyChange}
          disabled={disabled}
        />
      </Section>
    </div>
  )
}

function Section({
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
}: {
  value: GameRow | null
  onChange: (game: GameRow | null) => void
  disabled: boolean
  invalid: boolean
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Chip
            size="xl"
            disabled={disabled}
            data-active={value ? "true" : undefined}
            className={cn(
              "max-w-full",
              invalid &&
                !value &&
                "border-destructive text-destructive hover:border-destructive hover:text-destructive",
            )}
          />
        }
      >
        {value ? (
          <>
            <GameIcon src={value.iconUrl ?? value.logoUrl} name={value.name} />
            <span className="min-w-0 truncate">{value.name}</span>
          </>
        ) : (
          <>
            <Gamepad2Icon />
            Add game
          </>
        )}
        <ChevronDownIcon className="text-foreground-faint" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <GameCombobox
          value={value}
          onChange={(next) => {
            onChange(next)
            if (next) setOpen(false)
          }}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}

function VisibilityPickerChip({
  value,
  onChange,
  disabled,
}: {
  value: ClipPrivacy
  onChange: (value: ClipPrivacy) => void
  disabled: boolean
}) {
  const active = PRIVACY_BY_VALUE[value]
  const ActiveIcon = active.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Chip size="xl" data-active="true" disabled={disabled}>
            <ActiveIcon />
            {active.label}
            <ChevronDownIcon className="text-foreground-faint" />
          </Chip>
        }
      />
      <DropdownMenuContent align="start" className="w-44">
        {PRIVACY_OPTIONS.map((option) => {
          const Icon = option.icon
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => onChange(option.value)}
            >
              <Icon className="size-4" />
              {option.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
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

/**
 * Shared scaffolding for the chip-triggered search popovers: open state, the
 * draft text (cleared on close), a debounced copy for queries, and an input
 * ref that grabs focus when the popover opens.
 */
function usePickerPopover() {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const debouncedDraft = useDebouncedValue(draft, 200)

  React.useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setDraft("")
  }

  return { open, draft, debouncedDraft, setDraft, inputRef, handleOpenChange }
}

const PICKER_INPUT_CLASS = cn(
  "w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm text-foreground",
  "outline-none placeholder:text-foreground-faint",
  "focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent-border/20 focus-visible:ring-inset",
)

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
  const { open, draft, debouncedDraft, setDraft, inputRef, handleOpenChange } =
    usePickerPopover()
  const searchQuery = useUserSearchQuery(debouncedDraft)

  const candidates = React.useMemo(() => {
    const rows = searchQuery.data ?? []
    return rows.filter((row) => !selectedIds.has(row.id) && row.id !== viewerId)
  }, [searchQuery.data, selectedIds, viewerId])

  const trimmed = debouncedDraft.trim()
  const isSearching = searchQuery.isFetching && trimmed.length > 0

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Chip size="xl" disabled={disabled}>
            <AtSignIcon />
            Tag people
          </Chip>
        }
      />
      <PopoverContent align="start" className="w-72 gap-2 p-2">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search people…"
          className={PICKER_INPUT_CLASS}
        />
        <div className="flex flex-col" role="listbox">
          {trimmed.length === 0 ? (
            <p className="text-foreground-faint px-1 py-1.5 text-xs">
              Type a name to search.
            </p>
          ) : candidates.length === 0 ? (
            <p className="text-foreground-faint px-1 py-1.5 text-xs">
              {isSearching ? "Searching…" : "No matches"}
            </p>
          ) : (
            candidates.map((user) => {
              const chip = userChipData(user)
              const handle = user.displayUsername || user.username
              return (
                <button
                  key={user.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => onPick(user)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left",
                    "text-foreground transition-colors hover:bg-surface-sunken",
                  )}
                >
                  <Avatar size="sm">
                    {chip.avatar.src ? (
                      <AvatarImage src={chip.avatar.src} alt={chip.name} />
                    ) : null}
                    <AvatarFallback
                      style={{
                        backgroundColor: chip.avatar.bg,
                        color: chip.avatar.fg,
                      }}
                    >
                      {chip.avatar.initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {chip.name}
                    </span>
                    <span className="text-foreground-faint block truncate text-xs">
                      @{handle}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
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
  const { open, draft, debouncedDraft, setDraft, inputRef, handleOpenChange } =
    usePickerPopover()
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
  const showSuggestions = debouncedDraft.length > 0 && suggestions.length > 0

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Chip size="xl" disabled={disabled}>
            <HashIcon />
            Add hashtag
          </Chip>
        }
      />
      <PopoverContent align="start" className="w-72 gap-2 p-2">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(sanitizeTag(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === ",") {
              e.preventDefault()
              commit(draft)
            } else if (
              e.key === "Backspace" &&
              draft === "" &&
              value.length > 0
            ) {
              onChange(value.slice(0, -1))
            }
          }}
          placeholder="Add hashtag…"
          className={PICKER_INPUT_CLASS}
        />
        {showSuggestions ? (
          <div className="flex flex-col" role="listbox">
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => commit(tag)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm",
                  "text-foreground transition-colors hover:bg-surface-sunken",
                )}
              >
                <HashIcon className="text-foreground-faint size-3.5" />
                {tag}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-foreground-faint px-1 py-1.5 text-xs">
            Type a tag and press Enter.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
