import type { ProfileCounts } from "@alloy/api"
import { t as tx, tp } from "@alloy/i18n"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import { Spinner } from "@alloy/ui/components/spinner"
import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

import { UserFollowRow } from "@/components/user/user-follow-row"
import {
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
          label={tp(counts.followers, "follower", "followers")}
          onClick={() => setOpen("followers")}
        />
        <FollowStatButton
          value={counts.following}
          label={tx("following")}
          onClick={() => setOpen("following")}
        />
      </div>

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {view === "followers" ? tx("Followers") : tx("Following")}
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
                  <UserFollowRow
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
                  ? tx("No followers yet.")
                  : tx("Not following anyone yet.")}
              </p>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
