import type { UserSearchResult } from "@alloy/api"
import { t } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Chip } from "@alloy/ui/components/chip"
import { cn } from "@alloy/ui/lib/utils"
import { AtSignIcon, ChevronRightIcon, HashIcon, XIcon } from "lucide-react"
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  ComponentPropsWithoutRef,
  KeyboardEventHandler,
  ReactNode,
  Ref,
  RefObject,
} from "react"

import { useSession } from "@/lib/auth-client"
import { sanitizeTag } from "@/lib/clip-fields"
import { useTagSearchQuery } from "@/lib/tag-queries"
import { useDebouncedValue } from "@/lib/use-debounced-value"
import { userChipData, userHandle } from "@/lib/user-display"
import { useUserSearchQuery } from "@/lib/user-queries"

export function useOutsideDismiss<T extends HTMLElement>(
  ref: RefObject<T | null>,
  enabled: boolean,
  onDismiss: () => void,
  ignoreTarget?: (target: Element) => boolean,
) {
  useEffect(() => {
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

function useInlinePicker() {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const debouncedDraft = useDebouncedValue(draft, 200)

  const close = useCallback(() => {
    setOpen(false)
    setDraft("")
  }, [])

  useOutsideDismiss(rootRef, open, close)

  useEffect(() => {
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
  icon: ReactNode
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
  icon: ReactNode
  value: string
  onChange: (value: string) => void
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
  inputRef: Ref<HTMLInputElement>
  placeholder: string
  disabled: boolean
  label: string
  completion?: string | null
  /** Combobox wiring: associated listbox id, its open state, active option id. */
  listboxId?: string
  listExpanded?: boolean
  activeOptionId?: string
} & Omit<ComponentPropsWithoutRef<"span">, "onChange" | "onKeyDown">

const PickerInputShell = forwardRef<HTMLSpanElement, PickerInputShellProps>(
  function PickerInputShell(
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
      listboxId,
      listExpanded,
      activeOptionId,
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
            role={listboxId ? "combobox" : undefined}
            aria-autocomplete={listboxId ? "list" : undefined}
            aria-expanded={listboxId ? Boolean(listExpanded) : undefined}
            aria-controls={listExpanded ? listboxId : undefined}
            aria-activedescendant={activeOptionId}
            className="placeholder:text-foreground-muted relative z-10 w-full bg-transparent text-sm leading-4 font-semibold outline-none placeholder:font-semibold"
          />
        </span>
      </span>
    )
  },
)

function completionTail(value: string, completion: string): string {
  if (!value) return completion
  if (!completion.toLowerCase().startsWith(value.toLowerCase())) return ""
  return completion.slice(value.length)
}

export function PeoplePicker({
  value,
  onChange,
  disabled,
}: {
  value: UserSearchResult[]
  onChange: (next: UserSearchResult[]) => void
  disabled: boolean
}) {
  const selectedIds = useMemo(() => new Set(value.map((u) => u.id)), [value])

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
  const label = userHandle(user)

  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-raised py-0.5 pr-1.5 pl-1 text-sm text-foreground",
        disabled && "opacity-60",
      )}
    >
      <Avatar size="sm">
        {chip.avatar.src ? (
          <AvatarImage src={chip.avatar.src} alt={label} />
        ) : null}
        <AvatarFallback
          style={{ backgroundColor: chip.avatar.bg, color: chip.avatar.fg }}
        >
          {chip.avatar.initials}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-[10rem] min-w-0 truncate font-medium">
        {label}
      </span>
      <button
        type="button"
        aria-label={t("Remove {name}", { name: label })}
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
  const listboxId = useId()
  const [activeIndex, setActiveIndex] = useState(0)

  const candidates = useMemo(() => {
    const rows = searchQuery.data ?? []
    return rows.filter((row) => !selectedIds.has(row.id) && row.id !== viewerId)
  }, [searchQuery.data, selectedIds, viewerId])

  useEffect(() => {
    setActiveIndex(0)
  }, [candidates])

  const trimmed = debouncedDraft.trim()
  const isSearching = searchQuery.isFetching && trimmed.length > 0
  const listOpen =
    open &&
    debouncedDraft === draft &&
    trimmed.length > 0 &&
    candidates.length > 0
  const suggestion = listOpen ? (candidates[activeIndex] ?? null) : null
  const suggestionLabel = suggestion ? userHandle(suggestion) : null

  const pick = (user: UserSearchResult) => {
    onPick(user)
    setDraft("")
    inputRef.current?.focus()
  }

  return (
    <div ref={rootRef} className="relative w-56 max-w-full">
      {open ? (
        <>
          <PickerInputShell
            icon={<AtSignIcon className="text-foreground-muted size-4" />}
            value={draft}
            onChange={setDraft}
            onKeyDown={(event) => {
              if (listOpen && event.key === "ArrowDown") {
                event.preventDefault()
                setActiveIndex((index) => (index + 1) % candidates.length)
                return
              }
              if (listOpen && event.key === "ArrowUp") {
                event.preventDefault()
                setActiveIndex(
                  (index) =>
                    (index - 1 + candidates.length) % candidates.length,
                )
                return
              }
              if (
                event.key === "Enter" ||
                event.key === "Tab" ||
                event.key === "ArrowRight"
              ) {
                if (suggestion) {
                  event.preventDefault()
                  pick(suggestion)
                }
                return
              }
              if (event.key === "Escape") {
                event.preventDefault()
                setOpen(false)
                setDraft("")
              }
            }}
            inputRef={inputRef}
            placeholder={t("Search people...")}
            disabled={disabled}
            label={t("Search people")}
            completion={suggestionLabel}
            listboxId={listboxId}
            listExpanded={listOpen}
            activeOptionId={
              listOpen ? `${listboxId}-option-${activeIndex}` : undefined
            }
            title={
              suggestionLabel
                ? t("Press Enter to add {name}", { name: suggestionLabel })
                : isSearching || trimmed.length > 0
                  ? t("No inline match")
                  : undefined
            }
          />
          {listOpen ? (
            <div
              id={listboxId}
              role="listbox"
              className="border-border bg-popover absolute top-full left-0 z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border p-1 shadow-md"
            >
              {candidates.map((user, index) => {
                const chip = userChipData(user)
                const label = userHandle(user)
                return (
                  <button
                    id={`${listboxId}-option-${index}`}
                    key={user.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={cn(
                      "hover:bg-surface-raised flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                      index === activeIndex && "bg-surface-raised",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      pick(user)
                    }}
                  >
                    <Avatar size="sm" className="shrink-0">
                      {chip.avatar.src ? (
                        <AvatarImage src={chip.avatar.src} alt={label} />
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
                      <span className="block truncate">{chip.name}</span>
                      <span className="text-foreground-faint block truncate text-xs">
                        {label}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </>
      ) : (
        <PickerChipTrigger
          icon={<AtSignIcon />}
          label={t("Tag people")}
          disabled={disabled}
          onClick={() => setOpen(true)}
        />
      )}
    </div>
  )
}

export function HashtagPicker({
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
          {"#"}
          {tag}
          <button
            type="button"
            aria-label={t("Remove #{tag}", { tag })}
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
  const listboxId = useId()
  const [activeIndex, setActiveIndex] = useState(0)
  const [suggestionFocused, setSuggestionFocused] = useState(false)

  const commit = (raw: string) => {
    const tag = sanitizeTag(raw)
    setDraft("")
    inputRef.current?.focus()
    if (!tag) return
    if (value.includes(tag)) return
    onChange([...value, tag])
  }

  const selected = useMemo(() => new Set(value), [value])
  const suggestions = useMemo(
    () => (searchQuery.data ?? []).filter((tag) => !selected.has(tag)),
    [searchQuery.data, selected],
  )

  useEffect(() => {
    setActiveIndex(0)
    setSuggestionFocused(false)
  }, [suggestions])

  const listOpen =
    open &&
    debouncedDraft === draft &&
    draft.trim().length > 0 &&
    suggestions.length > 0
  const suggestion = listOpen ? (suggestions[activeIndex] ?? null) : null

  return (
    <div ref={rootRef} className="relative w-56 max-w-full">
      {open ? (
        <>
          <PickerInputShell
            icon={<HashIcon className="text-foreground-muted size-4" />}
            value={draft}
            onChange={(next) => setDraft(sanitizeTag(next))}
            onKeyDown={(e) => {
              if (listOpen && e.key === "ArrowDown") {
                e.preventDefault()
                setSuggestionFocused(true)
                setActiveIndex((index) => (index + 1) % suggestions.length)
                return
              }
              if (listOpen && e.key === "ArrowUp") {
                e.preventDefault()
                setSuggestionFocused(true)
                setActiveIndex(
                  (index) =>
                    (index - 1 + suggestions.length) % suggestions.length,
                )
                return
              }
              if (e.key === "Tab" || e.key === "ArrowRight") {
                if (suggestion) {
                  e.preventDefault()
                  commit(suggestion)
                }
                return
              }
              // Enter commits the highlighted suggestion only once the user
              // has explicitly navigated the list; otherwise it adds the tag
              // exactly as typed, so a near-match suggestion never silently
              // overrides it.
              if (e.key === "Enter") {
                e.preventDefault()
                commit(suggestionFocused && suggestion ? suggestion : draft)
                return
              }
              if (e.key === " " || e.key === ",") {
                e.preventDefault()
                commit(draft)
                return
              }
              if (e.key === "Backspace" && draft === "" && value.length > 0) {
                onChange(value.slice(0, -1))
                return
              }
              if (e.key === "Escape") {
                e.preventDefault()
                setOpen(false)
                setDraft("")
              }
            }}
            inputRef={inputRef}
            placeholder={t("Add hashtag...")}
            disabled={disabled}
            label={t("Add hashtag")}
            completion={suggestion}
            listboxId={listboxId}
            listExpanded={listOpen}
            activeOptionId={
              listOpen ? `${listboxId}-option-${activeIndex}` : undefined
            }
            title={
              suggestion
                ? t("Press Tab to add #{tag}", { tag: suggestion })
                : t("Type a tag and press Enter")
            }
          />
          {listOpen ? (
            <div
              id={listboxId}
              role="listbox"
              className="border-border bg-popover absolute top-full left-0 z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border p-1 shadow-md"
            >
              {suggestions.map((tag, index) => (
                <button
                  id={`${listboxId}-option-${index}`}
                  key={tag}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={cn(
                    "hover:bg-surface-raised flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                    index === activeIndex && "bg-surface-raised",
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    commit(tag)
                  }}
                >
                  <HashIcon className="text-foreground-faint size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{tag}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <PickerChipTrigger
          icon={<HashIcon />}
          label={t("Add hashtag")}
          disabled={disabled}
          onClick={() => setOpen(true)}
        />
      )}
    </div>
  )
}
