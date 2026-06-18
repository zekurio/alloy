import { t as tx } from "@alloy/i18n"
export function electronAccelerator(value: string): string | null {
  const parts = hotkeyParts(value)
  if (parts.length === 0) return null

  const key = parts.at(-1)
  if (!key) return null

  const modifiers = parts
    .slice(0, -1)
    .map((part) => normalizedModifier(part))
    .filter((part): part is string => Boolean(part))
  if (modifiers.length !== parts.length - 1) return null

  const acceleratorKey = normalizedKey(key)
  if (!acceleratorKey) return null

  return [...new Set(modifiers), acceleratorKey].join("+")
}

function hotkeyParts(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed === "+") return ["+"]
  if (trimmed.endsWith("+")) {
    const modifiers = trimmed
      .slice(0, -1)
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean)
    return [...modifiers, "+"]
  }

  return trimmed
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizedModifier(value: string): string | null {
  switch (value.toLowerCase()) {
    case "ctrl":
    case "control":
      return tx("CommandOrControl")
    case "alt":
    case "option":
      return tx("Alt")
    case "shift":
      return tx("Shift")
    case "meta":
    case "cmd":
    case "command":
      return tx("Meta")
    default:
      return null
  }
}

function normalizedKey(value: string): string | null {
  const upper = value.toUpperCase()
  if (/^[A-Z0-9]$/.test(upper)) return upper
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(upper)) return upper
  if (upper === "SPACE") return tx("Space")

  return (
    {
      "+": "Plus",
      PLUS: "Plus",
      ",": ",",
      "-": "-",
      ".": ".",
      "/": "/",
      ";": ";",
      "=": "=",
      "[": "[",
      "\\": "\\",
      "]": "]",
      "`": "`",
      BACKSPACE: "Backspace",
      DELETE: "Delete",
      DOWN: "Down",
      ARROWDOWN: "Down",
      END: "End",
      ENTER: "Enter",
      ESC: "Esc",
      ESCAPE: "Esc",
      HOME: "Home",
      INSERT: "Insert",
      LEFT: "Left",
      ARROWLEFT: "Left",
      PAGEDOWN: "PageDown",
      PAGEUP: "PageUp",
      RIGHT: "Right",
      ARROWRIGHT: "Right",
      TAB: "Tab",
      UP: "Up",
      ARROWUP: "Up",
    }[upper] ?? null
  )
}
