import type { ClipMentionRef } from "@alloy/api"
import { t, tp } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { UserFollowRow } from "@/components/user/user-follow-row"
import { userChipData } from "@/lib/user-display"

function UserAvatar({
  user,
  size,
}: {
  user: ClipMentionRef
  size: "sm" | "md"
}) {
  const chip = userChipData(user)
  return (
    <Avatar size={size}>
      {chip.avatar.src ? (
        <AvatarImage src={chip.avatar.src} alt={chip.name} />
      ) : null}
      <AvatarFallback
        style={{ backgroundColor: chip.avatar.bg, color: chip.avatar.fg }}
      >
        {chip.avatar.initials}
      </AvatarFallback>
    </Avatar>
  )
}

interface ClipMentionsRowProps {
  mentions: ClipMentionRef[]
}

/** Mobile/full-bleed variant: avatar group + summary text on its own row. */
function ClipMentionsRow({ mentions }: ClipMentionsRowProps) {
  const [open, setOpen] = useState(false)
  if (mentions.length === 0) return null

  const first = mentions[0]
  if (!first) return null
  const others = mentions.length - 1
  const preview = mentions.slice(0, 3)
  const firstHandle = first.username

  return (
    <>
      <div className="-mx-1 flex items-center gap-2 px-1 py-0.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "rounded-md",
            "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          )}
          aria-label={t("View tagged users")}
        >
          <AvatarGroup>
            {preview.map((u) => (
              <UserAvatar key={u.id} user={u} size="sm" />
            ))}
          </AvatarGroup>
        </button>
        <span className="text-foreground-muted text-xs">
          {t("with")}{" "}
          <Link
            to="/u/$username"
            params={{ username: first.username }}
            className={cn(
              "font-medium text-foreground",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:text-accent focus-visible:text-accent focus-visible:outline-none",
            )}
          >
            {firstHandle}
          </Link>
          {others > 0
            ? t(" and {count} {label}", {
                count: others,
                label: tp(others, "other", "others"),
              })
            : null}
        </span>
      </div>

      <MentionsListDialog
        mentions={mentions}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

function MentionsListDialog({
  mentions,
  open,
  onOpenChange,
}: {
  mentions: ClipMentionRef[]
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Tagged in clip")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="max-h-[60vh] overflow-y-auto px-2 py-2">
          <ul className="flex flex-col">
            {mentions.map((u) => (
              <UserFollowRow
                key={u.id}
                user={u}
                onNavigate={() => onOpenChange(false)}
              />
            ))}
          </ul>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

export { ClipMentionsRow }
