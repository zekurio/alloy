import { Link } from "@tanstack/react-router"
import type { ProfileCounts, UserSearchResult } from "@workspace/api"
import {
  Avatar,
  AvatarFallback,
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
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/lib/toast"
import { cn } from "@workspace/ui/lib/utils"
import { UserPlusIcon } from "lucide-react"
import * as React from "react"

import { errorMessage } from "@/lib/error-message"
import { userAvatar } from "@/lib/user-display"
import {
  useToggleUserFollowMutation,
  useUserFollowersQuery,
  useUserFollowingQuery,
} from "@/lib/user-queries"

import { StatInline } from "./stat-inline"

type FollowModal = "followers" | "following" | null

type IdentityStatsProps = {
  handle: string
  counts: ProfileCounts
}

function FollowStatButton({
  value,
  label,
  onClick,
}: {
  value: number
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-sm",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      <StatInline value={value} label={label} />
    </button>
  )
}

export function IdentityStats({ handle, counts }: IdentityStatsProps) {
  const [open, setOpen] = React.useState<FollowModal>(null)
  const viewRef = React.useRef<Exclude<FollowModal, null>>("followers")
  if (open !== null) viewRef.current = open
  const view = viewRef.current

  const followersQuery = useUserFollowersQuery(handle, {
    enabled: open === "followers",
  })
  const followingQuery = useUserFollowingQuery(handle, {
    enabled: open === "following",
  })

  const list = view === "followers" ? followersQuery.data : followingQuery.data
  const loading =
    view === "followers" ? followersQuery.isLoading : followingQuery.isLoading

  return (
    <>
      <div className="text-foreground-muted flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium">
        <FollowStatButton
          value={counts.followers}
          label="followers"
          onClick={() => setOpen("followers")}
        />
        <FollowStatButton
          value={counts.following}
          label="following"
          onClick={() => setOpen("following")}
        />
      </div>

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {view === "followers" ? "Followers" : "Following"}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="max-h-[60vh] overflow-y-auto px-2 py-2">
            {loading ? (
              <div className="text-foreground-faint grid place-items-center px-2 py-4">
                <Spinner />
              </div>
            ) : list && list.length > 0 ? (
              <ul className="flex flex-col">
                {list.map((u) => (
                  <FollowRow
                    key={u.id}
                    user={u}
                    initiallyFollowing={view === "following"}
                    onNavigate={() => setOpen(null)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-foreground-faint px-2 py-4 text-center text-sm">
                {view === "followers"
                  ? "No followers yet."
                  : "Not following anyone yet."}
              </p>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}

function FollowRow({
  user,
  initiallyFollowing,
  onNavigate,
}: {
  user: UserSearchResult
  initiallyFollowing: boolean
  onNavigate: () => void
}) {
  const [following, setFollowing] = React.useState(initiallyFollowing)
  const followMutation = useToggleUserFollowMutation(user.username)
  const handle = user.displayUsername || user.username
  const displayName = user.name || `@${handle}`
  const avatar = userAvatar(user)
  const avatarStyle = { background: avatar.bg, color: avatar.fg }

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
          toast.error(errorMessage(err, "Something went wrong"))
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
        <Avatar size="md" style={avatarStyle}>
          {avatar.src ? (
            <AvatarImage src={avatar.src} alt={displayName} />
          ) : null}
          <AvatarFallback style={avatarStyle}>{avatar.initials}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="text-foreground block truncate text-sm">
            {displayName}
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
        {following ? "Following" : "Follow"}
      </Button>
    </li>
  )
}
