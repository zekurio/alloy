import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import { ShieldOffIcon, UserMinusIcon, UserPlusIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/components/sonner"

import { useSession } from "../lib/auth-client"
import {
  followUser,
  unblockUser,
  unfollowUser,
  type ProfileViewer,
} from "../lib/users-api"

export function ProfileActions({
  targetHandle,
  viewer,
  onChange,
}: {
  targetHandle: string
  viewer: ProfileViewer | null
  onChange: (next: ProfileViewer) => void
}) {
  const { data: session } = useSession()
  const navigate = useNavigate()
  const [pending, setPending] = React.useState(false)

  if (!session) {
    return (
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={() => {
          void navigate({ to: "/login" })
        }}
      >
        <UserPlusIcon />
        Sign in to follow
      </Button>
    )
  }

  // Self-profile: no follow controls.
  if (!viewer || viewer.isSelf) return null

  const { isFollowing, isBlocked, isBlockedBy } = viewer

  async function runFollow() {
    if (pending) return
    setPending(true)
    const prev = viewer!
    const optimistic: ProfileViewer = { ...prev, isFollowing: !isFollowing }
    onChange(optimistic)
    try {
      if (isFollowing) {
        await unfollowUser(targetHandle)
      } else {
        await followUser(targetHandle)
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
      await unblockUser(targetHandle)
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
        onClick={runUnblock}
        disabled={pending}
      >
        <ShieldOffIcon />
        {pending ? "Working…" : "Unblock"}
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
      onClick={runFollow}
      disabled={pending}
    >
      {isFollowing ? <UserMinusIcon /> : <UserPlusIcon />}
      {pending ? "Working…" : isFollowing ? "Following" : "Follow"}
    </Button>
  )
}
