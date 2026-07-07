import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { SmileIcon } from "lucide-react"

const EMOJI_GROUPS = [
  {
    label: t("Smileys"),
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
    label: t("Gestures"),
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
    label: t("Hearts"),
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
    label: t("Animals"),
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
    label: t("Food"),
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
    label: t("Activities"),
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
    label: t("Objects"),
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
    label: t("Symbols"),
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
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={t("Emoji")} />
        }
      >
        <SmileIcon />
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-80 overflow-y-auto">
        {EMOJI_GROUPS.map((group) => (
          <section key={group.label} className="space-y-1.5">
            <div className="text-foreground-faint px-1 text-xs font-semibold tracking-wide uppercase">
              {group.label}
            </div>
            <div className="grid grid-cols-8 gap-1">
              {group.emojis.map((emoji) => (
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
        ))}
      </PopoverContent>
    </Popover>
  )
}
