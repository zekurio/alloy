import { Button } from "@alloy/ui/components/button"
import { SectionTitle } from "@alloy/ui/components/section-head"
import { ClapperboardIcon, PencilIcon } from "lucide-react"
import * as React from "react"

export const DEFAULT_PROJECT_NAME = "Untitled project"

/**
 * The project title, styled like a route heading. Hovering reveals a pencil
 * affordance; clicking (or focusing) swaps in an inline field. Enter or blur
 * commits, Escape reverts, and an empty value falls back to the default name.
 */
export function EditableProjectName({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (!editing) return
    const input = inputRef.current
    input?.focus()
    input?.select()
  }, [editing])

  const beginEdit = () => {
    setDraft(value)
    setEditing(true)
  }

  const commit = () => {
    const next = draft.trim()
    onChange(next.length > 0 ? next : DEFAULT_PROJECT_NAME)
    setEditing(false)
  }

  // The icon stays put and only the text node swaps in place, so the row keeps
  // identical box metrics whether resting or editing — no vertical jump. The
  // input carries no border or padding of its own for the same reason.
  return (
    <SectionTitle className="group min-w-0">
      <ClapperboardIcon className="text-accent" />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commit()
            } else if (event.key === "Escape") {
              event.preventDefault()
              setEditing(false)
            }
          }}
          aria-label="Project name"
          className="field-sizing-content max-w-full min-w-[6ch] border-0 bg-transparent p-0 text-xl leading-7 font-semibold tracking-[-0.02em] text-inherit outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={beginEdit}
          title="Rename project"
          className="flex min-w-0 items-center gap-2"
        >
          <span className="truncate">{value}</span>
          <PencilIcon className="text-foreground-faint size-4! shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </SectionTitle>
  )
}

export function TransportButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
