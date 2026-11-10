import { t } from "@alloy/i18n"
import { fieldControlClassName } from "@alloy/ui/lib/field-control"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { XIcon } from "lucide-react"
import { useState } from "react"
import type { KeyboardEvent } from "react"

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"])

/**
 * Keys the Windows recorder can bind (`virtual_key` in the recorder's
 * hotkeys.rs), keyed by `event.code`. The values are the names it parses.
 * Letters and digits are handled separately.
 */
const CODE_KEYS = new Map([
  ["Minus", "-"],
  ["Equal", "="],
  ["Comma", ","],
  ["Period", "."],
  ["Slash", "/"],
  ["Semicolon", ";"],
  ["BracketLeft", "["],
  ["Backslash", "\\"],
  ["BracketRight", "]"],
  ["Backquote", "`"],
  ["Backspace", "Backspace"],
  ["Tab", "Tab"],
  ["Enter", "Enter"],
  ["NumpadEnter", "Enter"],
  ["Space", "Space"],
  ["PageUp", "PageUp"],
  ["PageDown", "PageDown"],
  ["End", "End"],
  ["Home", "Home"],
  ["ArrowLeft", "ArrowLeft"],
  ["ArrowUp", "ArrowUp"],
  ["ArrowRight", "ArrowRight"],
  ["ArrowDown", "ArrowDown"],
  ["Insert", "Insert"],
  ["Delete", "Delete"],
])

const PUNCTUATION_KEYS = new Set([
  "-",
  "=",
  ",",
  ".",
  "/",
  ";",
  "[",
  "\\",
  "]",
  "`",
])

/**
 * The base key of a keydown as the recorder names it, or null when it has no
 * binding for that key. Shift and AltGr change `event.key` ("!" for Shift+1),
 * so the key comes from the physical key, except where Windows binds by what
 * the key types: letters, and punctuation typed without Shift or Alt, follow
 * the keyboard layout.
 */
function keyFromEvent(event: KeyboardEvent): string | null {
  const { code, key } = event
  if (/^[a-z]$/i.test(key)) return key.toUpperCase()
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (!event.shiftKey && !event.altKey && PUNCTUATION_KEYS.has(key)) return key
  return CODE_KEYS.get(code) ?? null
}

type Combo = { combo: string } | { unsupported: true } | null

/**
 * Build a "Ctrl+Shift+F8"-style combo from a keydown: null for a modifier on
 * its own, `unsupported` for a key the recorder cannot bind.
 */
function comboFromEvent(event: KeyboardEvent): Combo {
  if (MODIFIER_KEYS.has(event.key)) return null
  const key = keyFromEvent(event)
  if (!key) return { unsupported: true }
  const parts: string[] = []
  if (event.ctrlKey) parts.push("Ctrl")
  if (event.altKey) parts.push("Alt")
  if (event.shiftKey) parts.push("Shift")
  if (event.metaKey) parts.push("Meta")
  parts.push(key)
  return { combo: parts.join("+") }
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
  const [listening, setListening] = useState(false)

  function handleKeyDown(event: KeyboardEvent) {
    if (!listening) return
    event.preventDefault()
    if (event.key === "Escape") {
      setListening(false)
      return
    }
    const result = comboFromEvent(event)
    if (!result) return
    setListening(false)
    if ("unsupported" in result) {
      toast.error(t("This key can't be used in a shortcut."))
      return
    }
    onChange(result.combo)
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
          fieldControlClassName,
          "inline-flex h-9 min-w-28 items-center justify-center px-3 font-mono text-xs font-medium sm:h-8",
          listening && "border-accent-border ring-accent-border/20 ring-2",
          !value && !listening && "text-foreground-faint font-sans",
          showClear && "pr-7",
        )}
      >
        {listening ? t("Press keys…") : value || t("Not set")}
      </button>
      {showClear ? (
        <button
          type="button"
          aria-label={t("Clear {label}", { label: ariaLabel })}
          title={t("Clear shortcut")}
          onClick={() => onChange("")}
          className="text-foreground-faint hover:text-danger absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm outline-none"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </div>
  )
}
