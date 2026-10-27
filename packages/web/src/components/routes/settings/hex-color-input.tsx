import { ColorPicker } from "@alloy/ui/components/color-picker"
import { Input } from "@alloy/ui/components/input"
import { cn } from "@alloy/ui/lib/utils"
import { useState } from "react"
import type { ReactNode } from "react"

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

/**
 * A `#rrggbb` text field beside a color picker. Typing reports only complete
 * colors, plus "" when `allowEmpty`. Leaving the field keeps what `commit`
 * turns into a color and otherwise restores `value`. Without `commit`, only
 * hex is valid, so the browser flags anything else.
 */
export function HexColorInput({
  id,
  value,
  label,
  swatch = value,
  placeholder,
  allowEmpty = false,
  className,
  commit,
  onChange,
  children,
}: {
  id: string
  value: string
  /** Names the color for the picker. */
  label: string
  /** What the picker shows, for fields whose value can be empty. */
  swatch?: string
  placeholder?: string
  allowEmpty?: boolean
  className?: string
  commit?: (draft: string) => string | null
  onChange: (color: string) => void
  /** Controls placed after the picker. */
  children?: ReactNode
}) {
  const [draft, setDraft] = useState(value)
  // A new value from outside (a picker, a reset) replaces whatever is typed.
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    setDraft(value)
  }

  function updateDraft(next: string) {
    setDraft(next)
    const color = next.trim()
    if (color === "" ? allowEmpty : HEX_COLOR_RE.test(color)) onChange(color)
  }

  function commitDraft() {
    const color = commit?.(draft) ?? null
    if (color) onChange(color)
    setDraft(color ?? value)
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        pattern={commit ? undefined : "#[0-9a-fA-F]{6}"}
        className={cn("min-w-0 flex-1 font-mono", className)}
        onChange={(event) => updateDraft(event.target.value)}
        onBlur={commitDraft}
      />
      <ColorPicker value={swatch} label={label} onValueChange={updateDraft} />
      {children}
    </div>
  )
}
