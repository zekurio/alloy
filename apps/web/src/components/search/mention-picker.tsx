import * as React from "react"
import { XIcon } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { cn } from "@workspace/ui/lib/utils"

import { useSession } from "@/lib/auth-client"
import { userChipData } from "@/lib/user-display"
import { useUserSearchQuery } from "@/lib/user-queries"
import { useDebouncedValue } from "@/lib/use-debounced-value"
import type { UserSearchResult } from "@workspace/api"

export interface MentionPickerProps {
  value: UserSearchResult[]
  onChange: (next: UserSearchResult[]) => void
  disabled?: boolean
  placeholder?: string
}

export function MentionPicker({
  value,
  onChange,
  disabled = false,
  placeholder = "Tag a user…",
}: MentionPickerProps) {
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? null
  const [draft, setDraft] = React.useState("")
  const [focused, setFocused] = React.useState(false)
  const [highlightIdx, setHighlightIdx] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const debouncedQuery = useDebouncedValue(draft, 200)
  const searchQuery = useUserSearchQuery(debouncedQuery)

  const selectedIds = React.useMemo(
    () => new Set(value.map((u) => u.id)),
    [value]
  )

  const candidates = React.useMemo(() => {
    const rows = searchQuery.data ?? []
    return rows.filter((row) => !selectedIds.has(row.id) && row.id !== viewerId)
  }, [searchQuery.data, selectedIds, viewerId])

  React.useEffect(() => {
    setHighlightIdx(0)
  }, [debouncedQuery, candidates.length])

  const addUser = (user: UserSearchResult) => {
    if (selectedIds.has(user.id)) return
    onChange([...value, user])
    setDraft("")
    setHighlightIdx(0)
    inputRef.current?.focus()
  }

  const removeUser = (id: string) => {
    onChange(value.filter((u) => u.id !== id))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && candidates.length > 0) {
      e.preventDefault()
      setHighlightIdx((i) => Math.min(i + 1, candidates.length - 1))
    } else if (e.key === "ArrowUp" && candidates.length > 0) {
      e.preventDefault()
      setHighlightIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      const pick = candidates[highlightIdx]
      if (pick) {
        e.preventDefault()
        addUser(pick)
      }
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1))
    } else if (e.key === "Escape") {
      setFocused(false)
      inputRef.current?.blur()
    }
  }

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node | null)) {
      setFocused(false)
    }
  }

  const trimmed = debouncedQuery.trim()
  const showDropdown = focused && trimmed.length > 0
  const isSearching = searchQuery.isFetching && trimmed.length > 0

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
      <div
        className={cn(
          "flex min-h-[30px] flex-wrap items-center gap-1.5 rounded-md border border-border bg-input px-2 py-1.5",
          "focus-within:border-accent-border focus-within:bg-surface-raised",
          disabled && "opacity-60"
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((u) => {
          const handle = u.displayUsername || u.username
          return (
            <span
              key={u.id}
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-sm bg-accent px-1.5",
                "text-xs font-medium text-accent-foreground"
              )}
            >
              @{handle}
              <button
                type="button"
                aria-label={`Remove @${handle}`}
                onClick={() => removeUser(u.id)}
                disabled={disabled}
                className="text-accent-foreground/70 transition-colors hover:text-accent-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={value.length === 0 ? placeholder : ""}
          className={cn(
            "min-w-[120px] flex-1 bg-transparent text-xs text-foreground",
            "outline-none placeholder:text-foreground-faint"
          )}
        />
      </div>

      {showDropdown ? (
        <div
          className={cn(
            "absolute bottom-full z-50 mb-1 w-full rounded-md border border-border bg-surface-raised",
            "shadow-md"
          )}
          role="listbox"
        >
          {candidates.length === 0 ? (
            <div className="px-3 py-2 text-xs text-foreground-faint">
              {isSearching ? "Searching…" : "No matches"}
            </div>
          ) : (
            candidates.map((user, idx) => {
              const active = idx === highlightIdx
              const chip = userChipData(user)
              const handle = user.displayUsername || user.username
              return (
                <button
                  key={user.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  tabIndex={-1}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onMouseDown={(e) => {
                    // mousedown so the blur doesn't fire before the pick.
                    e.preventDefault()
                    addUser(user)
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm",
                    "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-foreground hover:bg-surface-sunken"
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
                    <span className="block truncate text-xs text-foreground-faint">
                      @{handle}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}
