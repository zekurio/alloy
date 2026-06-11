import type { ProfileViewer } from "@alloy/api"
import { Button } from "@alloy/ui/components/button"
import { toast } from "@alloy/ui/lib/toast"
import { useNavigate } from "@tanstack/react-router"
import { ShieldOffIcon } from "lucide-react"
import * as React from "react"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { useToggleUserFollowMutation } from "@/lib/user-queries"

export function ProfileActions({
  targetHandle,
  viewer,
  onChange,
}: {
  targetHandle: string
  viewer: ProfileViewer | null | undefined
  onChange: (next: ProfileViewer) => void
}) {
  const navigate = useNavigate()
  const followMutation = useToggleUserFollowMutation(targetHandle)
  const [unblockPending, setUnblockPending] = React.useState(false)
  const pending = unblockPending || followMutation.isPending

  if (viewer === undefined) {
    return (
      <Button
        type="button"
        variant="primary"
        size="sm"
        aria-label="Follow"
        disabled
      >
        Follow
      </Button>
    )
  }

  if (!viewer) {
    return (
      <Button
        type="button"
        variant="primary"
        size="sm"
        aria-label="Sign in to follow"
        title="Sign in to follow"
        onClick={() => {
          void navigate({ to: "/login" })
        }}
      >
        Follow
      </Button>
    )
  }

  // Self-profile: no follow controls.
  if (viewer.isSelf) return null

  const activeViewer = viewer
  const { isFollowing, isBlocked, isBlockedBy } = activeViewer

  function runFollow() {
    if (pending) return
    followMutation.mutate(
      { next: !isFollowing },
      {
        onError: (cause) => {
          toast.error(errorMessage(cause, "Something went wrong"))
        },
      },
    )
  }

  async function runUnblock() {
    if (pending) return
    setUnblockPending(true)
    const prev = activeViewer
    onChange({ ...prev, isBlocked: false })
    try {
      await api.users.unblock(targetHandle)
      toast.success("User unblocked")
    } catch (cause) {
      onChange(prev)
      toast.error(errorMessage(cause, "Something went wrong"))
    } finally {
      setUnblockPending(false)
    }
  }

  if (isBlocked) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Unblock"
        title="Unblock"
        onClick={runUnblock}
        disabled={pending}
      >
        <ShieldOffIcon />
        Unblock
      </Button>
    )
  }

  if (isBlockedBy) {
    return null
  }

  return (
    <Button
      type="button"
      variant={isFollowing ? "ghost" : "primary"}
      size="sm"
      aria-pressed={isFollowing}
      aria-label={isFollowing ? "Unfollow" : "Follow"}
      title={isFollowing ? "Unfollow" : "Follow"}
      onClick={runFollow}
      disabled={pending}
    >
      {isFollowing ? "Following" : "Follow"}
    </Button>
  )
}
