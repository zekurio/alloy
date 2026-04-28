import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import { ShieldOffIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/lib/toast"

import type { ProfileViewer } from "@workspace/api"

import { api } from "@/lib/api"

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
  const [pending, setPending] = React.useState(false)

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

  const { isFollowing, isBlocked, isBlockedBy } = viewer

  async function runFollow() {
    if (pending) return
    setPending(true)
    const prev = viewer!
    const optimistic: ProfileViewer = { ...prev, isFollowing: !isFollowing }
    onChange(optimistic)
    try {
      if (isFollowing) {
        await api.users.unfollow(targetHandle)
      } else {
        await api.users.follow(targetHandle)
      }
    } catch (cause) {
      onChange(prev) // roll back
      toast.error(
        cause instanceof Error ? cause.message : "Something went wrong"
      )
    } finally {
      setPending(false)
    }
  }

  async function runUnblock() {
    if (pending) return
    setPending(true)
    const prev = viewer!
    onChange({ ...prev, isBlocked: false })
    try {
      await api.users.unblock(targetHandle)
      toast.success("User unblocked")
    } catch (cause) {
      onChange(prev)
      toast.error(
        cause instanceof Error ? cause.message : "Something went wrong"
      )
    } finally {
      setPending(false)
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
