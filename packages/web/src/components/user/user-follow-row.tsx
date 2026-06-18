import type { UserSummary } from "@alloy/contracts"
import { t as tx } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Button } from "@alloy/ui/components/button"
import { toast } from "@alloy/ui/lib/toast"
import { Link } from "@tanstack/react-router"
import { UserPlusIcon } from "lucide-react"
import * as React from "react"

import { errorMessage } from "@/lib/error-message"
import { userChipData } from "@/lib/user-display"
import { useToggleUserFollowMutation } from "@/lib/user-queries"

/**
 * One user in a follow list dialog: avatar, name/handle link, and an
 * optimistically-toggled follow button. `initiallyFollowing` seeds the button
 * state when the surrounding list already knows the viewer follows the user;
 * lists without that knowledge start every row in "Follow" mode.
 */
export function UserFollowRow({
  user,
  initiallyFollowing = false,
  onNavigate,
}: {
  user: UserSummary
  initiallyFollowing?: boolean
  onNavigate: () => void
}) {
  const [following, setFollowing] = React.useState(initiallyFollowing)
  const followMutation = useToggleUserFollowMutation(user.username)
  const chip = userChipData(user)
  const handle = user.displayUsername || user.username

  React.useEffect(() => {
    setFollowing(initiallyFollowing)
  }, [initiallyFollowing, user.id])

  const toggle = () => {
    const next = !following
    setFollowing(next)
    followMutation.mutate(
      { next },
      {
        onError: (err) => {
          setFollowing(!next)
          toast.error(errorMessage(err, tx("Something went wrong")))
        },
      },
    )
  }

  return (
    <li className="hover:bg-surface-raised flex items-center gap-3 rounded-md px-2 py-2">
      <Link
        to="/u/$username"
        params={{ username: user.username }}
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <Avatar size="md">
          {chip.avatar.src ? (
            <AvatarImage src={chip.avatar.src} alt={chip.name} />
          ) : null}
          <AvatarFallback
            style={{ backgroundColor: chip.avatar.bg, color: chip.avatar.fg }}
          >
            {chip.avatar.initials}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="text-foreground block truncate text-sm">
            {chip.name}
          </span>
          <span className="text-foreground-faint block truncate text-xs">
            @{handle}
          </span>
        </span>
      </Link>
      <Button
        type="button"
        size="sm"
        variant={following ? "ghost" : "primary"}
        disabled={followMutation.isPending}
        onClick={toggle}
      >
        <UserPlusIcon className="size-3.5" />
        {following ? tx("Following") : tx("Follow")}
      </Button>
    </li>
  )
}
