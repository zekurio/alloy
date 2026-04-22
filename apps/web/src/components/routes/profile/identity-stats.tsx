import * as React from "react"
import { Link } from "@tanstack/react-router"
import { UserPlusIcon } from "lucide-react"

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
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"

import {
  useUserFollowersQuery,
  useUserFollowingQuery,
} from "@/lib/user-queries"
import {
  followUser,
  unfollowUser,
  type ProfileCounts,
  type UserSearchResult,
} from "@/lib/users-api"
import { StatInline } from "./stat-inline"

type FollowModal = "followers" | "following" | null

type IdentityStatsProps = {
  handle: string
  counts: ProfileCounts
}

function StatSeparator() {
  return (
    <span aria-hidden className="text-foreground-muted/80">
      ·
    </span>
  )
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
        "hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
      <div className="flex items-center gap-4 text-sm font-medium text-foreground-muted">
        <StatInline value={counts.clips} label="clips" />
        <StatSeparator />
        <FollowStatButton
          value={counts.followers}
          label="followers"
          onClick={() => setOpen("followers")}
        />
        <StatSeparator />
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
              <p className="px-2 py-4 text-center text-sm text-foreground-faint">
                Loading…
              </p>
            ) : list && list.length > 0 ? (
              <ul className="flex flex-col">
                {list.map((u) => (
                  <FollowRow
                    key={u.id}
                    user={u}
                    onNavigate={() => setOpen(null)}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-2 py-4 text-center text-sm text-foreground-faint">
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
  onNavigate,
}: {
  user: UserSearchResult
  onNavigate: () => void
}) {
  const [following, setFollowing] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const handle = user.displayUsername || user.username
  const displayName = user.name || `@${handle}`
  const avatarSrc = user.image ?? undefined

  const toggle = async () => {
    setPending(true)
    const next = !following
    setFollowing(next)
    try {
      if (next) await followUser(user.username)
      else await unfollowUser(user.username)
    } catch (err) {
      setFollowing(!next)
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
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <Avatar size="md">
          <AvatarImage src={avatarSrc} alt={displayName} />
          <AvatarFallback>
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">
            {displayName}
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
