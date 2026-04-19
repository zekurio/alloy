import * as React from "react"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import { LogInIcon, LogOutIcon, UserIcon } from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { UserChip } from "@workspace/ui/components/user-chip"

import { signOut } from "../lib/auth-client"
import { useSuspenseSession } from "../lib/session-suspense"
import { userChipData } from "../lib/user-display"

/**
 * Header user chip + dropdown. Suspends on its own Suspense boundary until
 * better-auth's session atom has settled its first fetch, so we never flash
 * a "user" placeholder or a stale identity on first paint. After the initial
 * resolution the chip re-renders reactively for cross-tab sign-in/out and
 * profile edits without re-suspending.
 *
 * Signed-out visitors on public surfaces (e.g. `/u/$username`) get a
 * compact Sign-in link in place of the chip rather than the silly nil
 * user fallback.
 */
export function UserMenu() {
  return (
    <React.Suspense fallback={<UserChipSkeleton />}>
      <UserMenuInner />
    </React.Suspense>
  )
}

function UserMenuInner() {
  const session = useSuspenseSession()
  const router = useRouter()
  const navigate = useNavigate()

  if (!session) {
    return (
      <Link
        to="/login"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <LogInIcon />
        Sign in
      </Link>
    )
  }

  const user = session.user
  const chip = userChipData(user)
  // Profile URLs are keyed off the `username` handle. Better-auth maps the
  // `name` session field to our `username` DB column (see auth.ts:
  // `user.fields.name = "username"`), so the handle surfaces as `user.name`
  // on the session. Every user has one — the `create.before` hook generates
  // it unconditionally.
  const profileHandle = user.name

  async function onSignOut() {
    try {
      await signOut()
      await router.invalidate()
      await navigate({ to: "/login" })
    } catch (cause) {
      toast.error("Couldn't sign out", {
        description:
          cause instanceof Error
            ? cause.message
            : "Something went wrong. Please try again.",
      })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<UserChip name={chip.name} avatar={chip.avatar} />}
      />
      <DropdownMenuContent align="end" sideOffset={6}>
        <DropdownMenuItem
          render={
            <Link to="/u/$username" params={{ username: profileHandle }} />
          }
        >
          <UserIcon />
          My profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onSignOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserChipSkeleton() {
  return (
    <div
      data-slot="user-chip-skeleton"
      className="inline-flex h-[30px] items-center gap-2 rounded-md border border-border bg-surface-raised py-[3px] pr-3 pl-[3px]"
      aria-hidden
    >
      <Skeleton className="size-6 rounded-[3px]" />
      <Skeleton className="h-3 w-20" />
    </div>
  )
}
