import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { SmileIcon } from "lucide-react"
import { useState } from "react"

import {
  readLocalStorageItem,
  writeLocalStorageItem,
} from "@/lib/browser-storage"

// Labels are translation keys resolved at render time — module-scope t()
// would freeze them to the locale active at first import.
const EMOJI_GROUPS = [
  {
    label: "Smileys",
    emojis: [
      "😀",
      "😃",
      "😄",
      "😁",
      "😆",
      "😅",
      "😂",
      "🤣",
      "😊",
      "😇",
      "🙂",
      "🙃",
      "😉",
      "😍",
      "😘",
      "😗",
      "😙",
      "😚",
      "😋",
      "😛",
      "😜",
      "🤪",
      "😎",
      "🥳",
    ],
  },
  {
    label: "Gestures",
    emojis: [
      "👍",
      "👎",
      "👌",
      "🤌",
      "🤞",
      "🤟",
      "🤘",
      "🤙",
      "👈",
      "👉",
      "👆",
      "👇",
      "☝️",
      "✋",
      "🤚",
      "🖐️",
      "👋",
      "👏",
      "🙌",
      "🫶",
      "🙏",
      "💪",
    ],
  },
  {
    label: "Hearts",
    emojis: [
      "❤️",
      "🧡",
      "💛",
      "💚",
      "💙",
      "💜",
      "🖤",
      "🤍",
      "🤎",
      "💔",
      "❤️‍🔥",
      "💕",
      "💞",
      "💓",
      "💗",
      "💖",
      "💘",
      "💝",
      "💟",
    ],
  },
  {
    label: "Animals",
    emojis: [
      "🐶",
      "🐱",
      "🐭",
      "🐹",
      "🐰",
      "🦊",
      "🐻",
      "🐼",
      "🐨",
      "🐯",
      "🦁",
      "🐮",
      "🐷",
      "🐸",
      "🐵",
      "🐔",
      "🐧",
      "🐦",
      "🐺",
      "🐲",
    ],
  },
  {
    label: "Food",
    emojis: [
      "🍏",
      "🍎",
      "🍐",
      "🍊",
      "🍋",
      "🍌",
      "🍉",
      "🍇",
      "🍓",
      "🫐",
      "🍒",
      "🍑",
      "🥭",
      "🍍",
      "🥝",
      "🍅",
      "🍔",
      "🍟",
      "🍕",
      "🌮",
      "🍣",
      "🍩",
    ],
  },
  {
    label: "Activities",
    emojis: [
      "⚽",
      "🏀",
      "🏈",
      "⚾",
      "🎾",
      "🏐",
      "🎱",
      "🏓",
      "🏸",
      "🥊",
      "🏆",
      "🎮",
      "🎲",
      "🎯",
      "🎳",
      "🎤",
      "🎧",
      "🎬",
      "🎨",
      "🎉",
    ],
  },
  {
    label: "Objects",
    emojis: [
      "⌚",
      "📱",
      "💻",
      "⌨️",
      "🖱️",
      "💾",
      "📷",
      "🎥",
      "💡",
      "🔦",
      "📚",
      "📌",
      "✂️",
      "🔒",
      "🔑",
      "🔨",
      "🛠️",
      "🧲",
      "🧪",
      "🧯",
    ],
  },
  {
    label: "Symbols",
    emojis: [
      "✅",
      "❌",
      "❗",
      "❓",
      "💯",
      "🔥",
      "✨",
      "⭐",
      "🌟",
      "💫",
      "⚡",
      "💥",
      "💢",
      "💤",
      "💦",
      "🎵",
      "🔔",
      "🔕",
      "♻️",
      "🔰",
    ],
  },
] as const

export function CommentEmojiPicker({
  onSelect,
}: {
  onSelect: (emoji: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) setRecent(loadRecentEmojis())
  }
  const pick = (emoji: string) => {
    onSelect(emoji)
    setOpen(false)
    saveRecentEmoji(emoji)
  }
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={t("Emoji")} />
        }
      >
        <SmileIcon />
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-80 overflow-y-auto">
        {recent.length > 0 ? (
          <EmojiSection
            label={t("Recently used")}
            emojis={recent}
            onSelect={pick}
          />
        ) : null}
        {EMOJI_GROUPS.map((group) => (
          <EmojiSection
            key={group.label}
            label={t(group.label)}
            emojis={group.emojis}
            onSelect={pick}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}

function EmojiSection({
  label,
  emojis,
  onSelect,
}: {
  label: string
  emojis: readonly string[]
  onSelect: (emoji: string) => void
}) {
  return (
    <section className="space-y-1.5">
      <div className="text-foreground-faint px-1 text-xs font-semibold tracking-wide uppercase">
        {label}
      </div>
      <div className="grid grid-cols-8 gap-1">
        {emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={emoji}
            className="hover:bg-surface-raised focus-visible:ring-ring rounded-md p-1.5 text-lg leading-none transition-colors focus-visible:ring-2 focus-visible:outline-none"
            onClick={() => onSelect(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </section>
  )
}

const RECENT_EMOJI_KEY = "alloy:comment-emoji-recent"
const RECENT_EMOJI_LIMIT = 16

function loadRecentEmojis(): string[] {
  const raw = readLocalStorageItem(RECENT_EMOJI_KEY)
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((value): value is string => typeof value === "string")
    .slice(0, RECENT_EMOJI_LIMIT)
}

function saveRecentEmoji(emoji: string): void {
  const next = [
    emoji,
    ...loadRecentEmojis().filter((value) => value !== emoji),
  ].slice(0, RECENT_EMOJI_LIMIT)
  writeLocalStorageItem(RECENT_EMOJI_KEY, JSON.stringify(next))
}
