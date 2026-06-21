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
import { userChipData } from "@/lib/user-display"
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
        aria-label={t("Remove {name}", { name: chip.name })}
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

  const candidates = useMemo(() => {
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
    <div ref={rootRef} className="relative w-56 max-w-full">
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
          placeholder={t("Search people...")}
          disabled={disabled}
          label={t("Search people")}
          completion={suggestionChip?.name ?? null}
          title={
            suggestionChip
              ? t("Press Enter to add {name}", {
                  name: suggestionChip.name,
                })
              : isSearching || trimmed.length > 0
                ? t("No inline match")
                : undefined
          }
        />
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
  const suggestion = suggestions[0] ?? null

  return (
    <div ref={rootRef} className="relative w-56 max-w-full">
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
          placeholder={t("Add hashtag...")}
          disabled={disabled}
          label={t("Add hashtag")}
          completion={suggestion}
          title={
            suggestion
              ? t("Press Enter to add #{tag}", { tag: suggestion })
              : t("Type a tag and press Enter")
          }
        />
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
