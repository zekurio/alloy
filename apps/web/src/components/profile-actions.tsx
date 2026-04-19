import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  MoreHorizontalIcon,
  ShieldOffIcon,
  UserMinusIcon,
  UserPlusIcon,
  UserXIcon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { toast } from "@workspace/ui/components/sonner"

import { useSession } from "../lib/auth-client"
import {
  blockUser,
  followUser,
  unblockUser,
  unfollowUser,
  type ProfileViewer,
} from "../lib/users-api"

/**
 * Follow / unfollow / block / unblock controls for a user profile. The layout
 * pairs a primary follow button with an overflow menu for destructive
 * actions (block) — block has irreversible consequences (it severs follows
 * in both directions) so it lives behind a confirm dialog, not a casual
 * button click.
 *
 * State strategy: we read the server-authoritative `viewer` once during the
 * initial profile fetch and then mutate it optimistically on each action so
 * the UI doesn't flicker while the request is in flight. A failed request
 * rolls back the optimistic update and surfaces a toast.
 */
export function ProfileActions({
  targetHandle,
  viewer,
  onChange,
}: {
  /**
   * Either the target's username or their raw user id — the API resolves
   * both. The parent profile page has the full user row and can pick
   * whichever it prefers; once everyone has a username populated, callers
   * should pass that for consistency with the URL.
   */
  targetHandle: string
  viewer: ProfileViewer | null
  /**
   * Fires after a successful mutation so the parent can re-fetch profile
   * counts. Called with the updated viewer so the parent doesn't have to
   * duplicate the optimistic logic.
   */
  onChange: (next: ProfileViewer) => void
}) {
  const { data: session } = useSession()
  const navigate = useNavigate()
  const [pending, setPending] = React.useState(false)

  // Signed-out visitors get a single "Sign in to follow" CTA. We deliberately
  // don't render the whole row as disabled — that reads as "you can't do
  // this" rather than "you're not signed in yet".
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
        <UserPlusIcon className="size-4" />
        Sign in to follow
      </Button>
    )
  }

  // Self-profile: no follow/block controls (you can still get to
  // /user-settings for account settings via the user menu).
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

  async function runBlock() {
    if (pending) return
    setPending(true)
    const prev = viewer!
    // Blocking also drops the follow edge — mirror that client-side so the
    // "Following" state disappears immediately rather than waiting for the
    // next profile refresh.
    const optimistic: ProfileViewer = {
      ...prev,
      isBlocked: true,
      isFollowing: false,
    }
    onChange(optimistic)
    try {
      await blockUser(targetHandle)
      toast.success("User blocked")
    } catch (cause) {
      onChange(prev)
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

  // When the viewer is on a block side, collapse the controls: if the viewer
  // did the blocking we offer unblock; if they're the blocked party we show
  // nothing (they shouldn't even know about the block — but the server
  // reveals `isBlockedBy` to scope down affordances, e.g. hide the follow
  // button so they can't keep re-trying).
  if (isBlocked) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={runUnblock}
        disabled={pending}
      >
        <ShieldOffIcon className="size-4" />
        {pending ? "Working…" : "Unblock"}
      </Button>
    )
  }

  if (isBlockedBy) {
    // The other side has blocked the viewer — no follow CTA. We still let
    // them leave via Back / close; no button rendered here.
    return null
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant={isFollowing ? "ghost" : "primary"}
        size="sm"
        onClick={runFollow}
        disabled={pending}
      >
        {isFollowing ? (
          <UserMinusIcon className="size-4" />
        ) : (
          <UserPlusIcon className="size-4" />
        )}
        {pending ? "Working…" : isFollowing ? "Following" : "Follow"}
      </Button>

      <AlertDialog>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="More actions"
              >
                <MoreHorizontalIcon className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" sideOffset={6}>
            <AlertDialogTrigger
              render={
                <DropdownMenuItem variant="destructive">
                  <UserXIcon />
                  Block user
                </DropdownMenuItem>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block this user?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll stop seeing each other's clips and neither of you will be
              able to follow the other. You can undo this at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={runBlock}
              disabled={pending}
            >
              {pending ? "Blocking…" : "Block user"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
