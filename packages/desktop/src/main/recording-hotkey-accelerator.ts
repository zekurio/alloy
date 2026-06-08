export function electronAccelerator(value: string): string | null {
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
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

function normalizedModifier(value: string): string | null {
  switch (value.toLowerCase()) {
    case "ctrl":
    case "control":
      return "CommandOrControl"
    case "alt":
    case "option":
      return "Alt"
    case "shift":
      return "Shift"
    case "meta":
    case "cmd":
    case "command":
      return "Meta"
    default:
      return null
  }
}

function normalizedKey(value: string): string | null {
  const upper = value.toUpperCase()
  if (/^[A-Z0-9]$/.test(upper)) return upper
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(upper)) return upper
  if (upper === "SPACE") return "Space"

  return (
    {
      "+": "Plus",
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
      END: "End",
      ENTER: "Enter",
      ESC: "Esc",
      ESCAPE: "Esc",
      HOME: "Home",
      INSERT: "Insert",
      LEFT: "Left",
      PAGEDOWN: "PageDown",
      PAGEUP: "PageUp",
      RIGHT: "Right",
      TAB: "Tab",
      UP: "Up",
    }[upper] ?? null
  )
}
