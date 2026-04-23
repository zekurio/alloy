import * as React from "react"
import { Link } from "@tanstack/react-router"
import { PencilIcon } from "lucide-react"

import { Chip, chipVariants } from "@workspace/ui/components/chip"
import { GameIcon } from "@workspace/ui/components/game-icon"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { toast } from "@workspace/ui/components/sonner"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import type { ClipGameRef, GameRow } from "@workspace/api"

import { useUpdateClipMutation } from "@/lib/clip-queries"
import { CLIP_DESCRIPTION_MAX, CLIP_TITLE_MAX } from "@/lib/clip-fields"

import { GameCombobox } from "@/components/game/game-combobox"
export { EditableMentions, PrivacyBadgeMenu } from "./clip-privacy-and-mentions"

const editPencilVariants = {
  title: cn(
    "ml-2 size-4 shrink-0",
    "text-foreground-faint opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
  ),
  description: cn(
    "pointer-events-none absolute top-1.5 right-2 size-3.5",
    "text-foreground-faint opacity-0 transition-opacity",
    "group-hover/desc:opacity-100 group-focus-visible/desc:opacity-100"
  ),
} as const

function EditPencil({ variant }: { variant: keyof typeof editPencilVariants }) {
  return <PencilIcon aria-hidden className={editPencilVariants[variant]} />
}

export function EditableTitle({
  clipId,
  value,
  canEdit,
}: {
  clipId: string
  value: string
  canEdit: boolean
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const mutation = useUpdateClipMutation()
  const saving = mutation.isPending
  const pendingTitle =
    mutation.isPending && mutation.variables?.clipId === clipId
      ? mutation.variables.input.title
      : undefined
  const displayValue = pendingTitle ?? value

  // Mirror fresh server values only when not editing — router
  // invalidations mid-edit would clobber the user's typing.
  React.useEffect(() => {
    if (!editing) setDraft(value)
  }, [editing, value])

  React.useEffect(() => {
    if (editing) {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    }
  }, [editing])

  const cancel = () => {
    setDraft(value)
    setError(null)
    setEditing(false)
  }

  const commit = () => {
    const trimmed = draft.trim()
    // Empty title is invalid — bail without saving. Shared by Enter and
    // blur; Enter shows inline error first, blur silently reverts.
    if (!trimmed) {
      setDraft(value)
      setError(null)
      setEditing(false)
      return
    }
    if (trimmed === value) {
      setEditing(false)
      setError(null)
      return
    }
    setError(null)
    mutation.mutate(
      { clipId, input: { title: trimmed } },
      {
        onError: () => {
          toast.error("Couldn't save title")
          setDraft(value)
        },
      }
    )
    setEditing(false)
  }

  if (!canEdit) {
    return (
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
        {displayValue}
      </h1>
    )
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              if (!draft.trim()) {
                setError("Title can't be empty.")
                return
              }
              void commit()
            } else if (e.key === "Escape") {
              e.preventDefault()
              cancel()
            }
          }}
          onBlur={() => void commit()}
          maxLength={CLIP_TITLE_MAX}
          disabled={saving}
          aria-label="Title"
          aria-invalid={error !== null}
          className={cn(
            "h-auto rounded-sm border-0 bg-transparent p-0 text-2xl font-semibold tracking-[-0.02em] text-foreground",
            "hover:border-transparent hover:bg-transparent",
            "focus-visible:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0",
            saving && "opacity-60"
          )}
        />
        {error ? (
          <span className="text-xs text-destructive" aria-live="polite">
            {error}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label="Edit title"
      className={cn(
        "group/title inline-flex w-fit items-center text-left",
        "cursor-text rounded-sm",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-border"
      )}
    >
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
        {displayValue}
      </h1>
      <EditPencil variant="title" />
    </button>
  )
}

export function EditableGame({
  clipId,
  displayName,
  gameRef,
  canEdit,
}: {
  clipId: string
  displayName: string
  gameRef: ClipGameRef | null
  canEdit: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [pendingRow, setPendingRow] = React.useState<GameRow | null>(null)
  const mutation = useUpdateClipMutation()
  const saving = mutation.isPending

  React.useEffect(() => {
    if (!mutation.isPending) setPendingRow(null)
  }, [mutation.isPending])

  const effectiveLabel = pendingRow ? pendingRow.name : displayName
  const effectiveSlug = pendingRow ? pendingRow.slug : (gameRef?.slug ?? null)
  const effectiveIcon = pendingRow
    ? (pendingRow.iconUrl ?? pendingRow.logoUrl ?? null)
    : (gameRef?.iconUrl ?? gameRef?.logoUrl ?? null)

  const initialValue: GameRow | null =
    pendingRow ??
    (gameRef
      ? {
          id: gameRef.id,
          steamgriddbId: gameRef.steamgriddbId,
          name: gameRef.name,
          slug: gameRef.slug,
          releaseDate: gameRef.releaseDate,
          heroUrl: gameRef.heroUrl,
          gridUrl: gameRef.gridUrl,
          logoUrl: gameRef.logoUrl,
          iconUrl: gameRef.iconUrl,
        }
      : null)

  const commit = React.useCallback(
    (row: GameRow | null) => {
      if (!row) {
        setOpen(false)
        return
      }
      if (row.id === gameRef?.id) {
        setOpen(false)
        return
      }
      setPendingRow(row)
      mutation.mutate(
        { clipId, input: { gameId: row.id } },
        {
          onError: () => {
            setPendingRow(null)
            toast.error("Couldn't save game")
          },
        }
      )
      setOpen(false)
    },
    [clipId, gameRef?.id, mutation]
  )

  const chipBody = (
    <>
      <GameIcon src={effectiveIcon} name={effectiveLabel} />
      <span className="truncate">{effectiveLabel}</span>
    </>
  )

  if (!canEdit) {
    if (gameRef) {
      return (
        <Link
          to="/g/$slug"
          params={{ slug: gameRef.slug }}
          className={cn(chipVariants({ size: "lg" }))}
          title={effectiveLabel}
        >
          {chipBody}
        </Link>
      )
    }
    return (
      <Chip size="lg" render={<span />} title={effectiveLabel}>
        {chipBody}
      </Chip>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Chip
            size="lg"
            title={effectiveLabel}
            aria-label="Edit game"
            className={cn(saving && "opacity-60")}
          />
        }
      >
        {chipBody}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] gap-2 p-2">
        <GameCombobox
          value={initialValue}
          onChange={commit}
          disabled={saving}
          allowClear={false}
          side="top"
        />
        {effectiveSlug && !saving ? (
          <Link
            to="/g/$slug"
            params={{ slug: effectiveSlug }}
            className={cn(
              "rounded-sm px-2 py-1 text-xs text-foreground-muted",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:bg-surface-raised hover:text-foreground"
            )}
          >
            Open game page →
          </Link>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

export function EditableDescription({
  clipId,
  value,
  canEdit,
}: {
  clipId: string
  value: string | null
  canEdit: boolean
}) {
  const current = value ?? ""
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(current)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const mutation = useUpdateClipMutation()
  const saving = mutation.isPending
  const pendingDescription =
    mutation.isPending && mutation.variables?.clipId === clipId
      ? mutation.variables.input.description
      : undefined
  const displayValue = pendingDescription ?? current
  const hasDescription = displayValue.trim().length > 0

  React.useEffect(() => {
    if (!editing) setDraft(current)
  }, [editing, current])

  React.useEffect(() => {
    if (editing) {
      const el = textareaRef.current
      if (el) {
        el.focus()
        // Caret at end instead of select-all — descriptions are multi-line.
        const len = el.value.length
        el.setSelectionRange(len, len)
      }
    }
  }, [editing])

  const cancel = () => {
    setDraft(current)
    setEditing(false)
  }

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === current) {
      setEditing(false)
      return
    }
    // Empty string is a deliberate clear — server nulls the column.
    mutation.mutate(
      { clipId, input: { description: trimmed } },
      {
        onError: () => {
          toast.error("Couldn't save description")
          setDraft(current)
        },
      }
    )
    setEditing(false)
  }

  if (editing) {
    return (
      <Textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            void commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            cancel()
          }
        }}
        onBlur={() => void commit()}
        rows={3}
        maxLength={CLIP_DESCRIPTION_MAX}
        disabled={saving}
        placeholder="Add a description — Enter to save, Shift+Enter for a newline."
        aria-label="Description"
        className={cn(
          "min-h-0 rounded-md px-3 py-2 text-base leading-relaxed",
          saving && "opacity-60"
        )}
      />
    )
  }

  if (!hasDescription && !canEdit) return null

  if (!hasDescription) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "group/desc -mx-2 flex w-fit items-center gap-2 rounded-md px-2 py-1 text-left",
          "text-base text-foreground-faint italic",
          "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "hover:text-foreground-muted",
          "focus-visible:text-foreground-muted focus-visible:outline-none"
        )}
        aria-label="Add a description"
      >
        Add a description…
        <PencilIcon
          aria-hidden
          className="size-3.5 opacity-0 transition-opacity group-hover/desc:opacity-60 group-focus-visible/desc:opacity-60"
        />
      </button>
    )
  }

  if (!canEdit) {
    return (
      <p className="text-base leading-relaxed whitespace-pre-wrap text-foreground-muted">
        {renderDescriptionTokens(displayValue, { linkHashtags: true })}
      </p>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label="Edit description"
      className={cn(
        "group/desc relative -mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:bg-surface-sunken",
        "focus-visible:bg-surface-sunken focus-visible:outline-none",
        "cursor-text"
      )}
    >
      <p className="text-base leading-relaxed whitespace-pre-wrap text-foreground-muted">
        {renderDescriptionTokens(displayValue, { linkHashtags: false })}
      </p>
      <EditPencil variant="description" />
    </button>
  )
}

export function renderDescriptionTokens(
  raw: string,
  { linkHashtags }: { linkHashtags: boolean }
): React.ReactNode[] {
  const pattern = /#([\p{L}\p{N}_]+)/gu
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = pattern.exec(raw)) !== null) {
    const start = match.index
    const end = pattern.lastIndex
    if (start > lastIndex) nodes.push(raw.slice(lastIndex, start))
    const tag = match[1]!
    if (linkHashtags) {
      nodes.push(
        <Link
          key={`tag-${key++}`}
          to="/"
          className="text-accent hover:underline"
        >
          #{tag}
        </Link>
      )
    } else {
      nodes.push(
        <span key={`tag-${key++}`} className="text-accent">
          #{tag}
        </span>
      )
    }
    lastIndex = end
  }
  if (lastIndex < raw.length) nodes.push(raw.slice(lastIndex))
  return nodes
}
