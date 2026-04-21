import * as React from "react"
import { Link } from "@tanstack/react-router"
import { UserPlusIcon } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"

import type { ClipMentionRef } from "../lib/clips-api"
import { userChipData } from "../lib/user-display"
import { followUser, unfollowUser } from "../lib/users-api"

interface ClipMentionsRowProps {
  mentions: ClipMentionRef[]
}

function ClipMentionsRow({ mentions }: ClipMentionsRowProps) {
  const [open, setOpen] = React.useState(false)
  if (mentions.length === 0) return null

  const first = mentions[0]!
  const others = mentions.length - 1
  const preview = mentions.slice(0, 3)
  const firstHandle = first.displayUsername || first.username

  return (
    <>
      <div className="-mx-1 flex items-center gap-2 px-1 py-0.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "rounded-md",
            "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
          aria-label="View tagged users"
        >
          <AvatarGroup>
            {preview.map((u) => {
              const chip = userChipData(u)
              return (
                <Avatar key={u.id} size="sm">
                  {chip.avatar.src ? (
                    <AvatarImage src={chip.avatar.src} alt={chip.name} />
                  ) : null}
                  <AvatarFallback
                    style={{
                      backgroundColor: chip.avatar.bg,
                      color: chip.avatar.fg,
                    }}
                  >
                    {chip.avatar.initials}
                  </AvatarFallback>
                </Avatar>
              )
            })}
          </AvatarGroup>
        </button>
        <span className="text-xs text-foreground-muted">
          with{" "}
          <Link
            to="/u/$username"
            params={{ username: first.username }}
            className={cn(
              "font-medium text-foreground",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:text-accent focus-visible:text-accent focus-visible:outline-none"
            )}
          >
            @{firstHandle}
          </Link>
          {others > 0 ? ` and ${others} other${others === 1 ? "" : "s"}` : null}
        </span>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Tagged in clip</DialogTitle>
          </DialogHeader>
          <DialogBody className="max-h-[60vh] overflow-y-auto px-2 py-2">
            <ul className="flex flex-col">
              {mentions.map((u) => (
                <MentionRow
                  key={u.id}
                  user={u}
                  onOpen={() => setOpen(false)}
                />
              ))}
            </ul>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}

function MentionRow({
  user,
  onOpen,
}: {
  user: ClipMentionRef
  onOpen: () => void
}) {
  // Tracks only in-dialog toggles — we don't pre-fetch the viewer's real
  // follow state per row, so the button always starts in "Follow" mode.
  const [following, setFollowing] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const chip = userChipData(user)
  const handle = user.displayUsername || user.username

  const toggle = async () => {
    setPending(true)
    const nextFollowing = !following
    setFollowing(nextFollowing)
    try {
      if (nextFollowing) await followUser(user.username)
      else await unfollowUser(user.username)
    } catch (err) {
      setFollowing(!nextFollowing)
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-raised">
      <Link
        to="/u/$username"
        params={{ username: user.username }}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <Avatar size="md">
          {chip.avatar.src ? (
            <AvatarImage src={chip.avatar.src} alt={chip.name} />
          ) : null}
          <AvatarFallback
            style={{
              backgroundColor: chip.avatar.bg,
              color: chip.avatar.fg,
            }}
          >
            {chip.avatar.initials}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">
            {chip.name}
          </span>
          <span className="block truncate text-xs text-foreground-faint">
            @{handle}
          </span>
        </span>
      </Link>
      <Button
        type="button"
        size="sm"
        variant={following ? "ghost" : "primary"}
        disabled={pending}
        onClick={() => void toggle()}
      >
        <UserPlusIcon className="size-3.5" />
        {following ? "Following" : "Follow"}
      </Button>
    </li>
  )
}

export { ClipMentionsRow }
