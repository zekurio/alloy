import type { GameRow, UserSearchResult } from "@alloy/api"
import { Chip } from "@alloy/ui/components/chip"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { Textarea } from "@alloy/ui/components/textarea"
import { cn } from "@alloy/ui/lib/utils"
import { ChevronRightIcon, Gamepad2Icon } from "lucide-react"
import * as React from "react"

import { GameCombobox } from "@/components/game/game-combobox"
import { CLIP_DESCRIPTION_MAX, CLIP_TITLE_MAX } from "@/lib/clip-fields"

import {
  HashtagPicker,
  PeoplePicker,
  useOutsideDismiss,
} from "./clip-metadata-pickers"

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
