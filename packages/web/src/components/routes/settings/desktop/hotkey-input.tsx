import { cn } from "@alloy/ui/lib/utils"
import { XIcon } from "lucide-react"
import * as React from "react"

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"])

/** Build a "Ctrl+Shift+F8"-style combo from a keydown, or null for modifier-only. */
function comboFromEvent(event: React.KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push("Ctrl")
  if (event.altKey) parts.push("Alt")
  if (event.shiftKey) parts.push("Shift")
  if (event.metaKey) parts.push("Meta")
  let key = event.key
  if (key === " ") key = "Space"
  else if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join("+")
}

/**
 * A button that captures the next key combination pressed while focused and
 * reports it as a string. Empty value renders as "Not set"; a clear button
 * unbinds it.
 */
export function HotkeyInput({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  ariaLabel: string
}) {
  const [listening, setListening] = React.useState(false)

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!listening) return
    event.preventDefault()
    if (event.key === "Escape") {
      setListening(false)
      return
    }
    const combo = comboFromEvent(event)
    if (combo) {
      onChange(combo)
      setListening(false)
    }
  }

  const showClear = Boolean(value) && !disabled && !listening

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setListening(true)}
        onKeyDown={handleKeyDown}
        onBlur={() => setListening(false)}
        className={cn(
          "border-border bg-input inline-flex h-9 min-w-28 items-center justify-center rounded-lg border px-3 font-mono text-xs font-medium transition-colors outline-none sm:h-8",
          "hover:border-border-strong hover:bg-surface-raised focus-visible:border-accent-border focus-visible:ring-accent-border/20 focus-visible:ring-2 focus-visible:ring-inset",
          "disabled:cursor-not-allowed disabled:opacity-50",
          listening && "border-accent-border ring-accent-border/20 ring-2",
          !value && !listening && "text-foreground-faint font-sans",
          showClear && "pr-7",
        )}
      >
        {listening ? "Press keys…" : value || "Not set"}
      </button>
      {showClear ? (
        <button
          type="button"
          aria-label={`Clear ${ariaLabel}`}
          title="Clear shortcut"
          onClick={() => onChange("")}
          className="text-foreground-faint hover:text-danger absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm outline-none"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </div>
  )
}
