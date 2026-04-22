import * as React from "react"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import { LogInIcon, LogOutIcon } from "lucide-react"

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
import { UserAvatarButton } from "@workspace/ui/components/user-avatar-button"

import { signOut } from "@/lib/auth-client"
import { getQueryClient } from "@/lib/query-client"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useUserChipData } from "@/lib/user-display"

export function UserMenu() {
  return (
    <React.Suspense fallback={<UserAvatarSkeleton />}>
      <UserMenuInner />
    </React.Suspense>
  )
}

function UserMenuInner() {
  const session = useSuspenseSession()
  const router = useRouter()
  const navigate = useNavigate()
  const chip = useUserChipData(session?.user)

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
  const handle = user.username ?? user.displayUsername ?? null
  const email = user.email ?? null
  const primaryLabel = handle ? `@${handle}` : chip.name

  async function onSignOut() {
    try {
      await signOut()
      getQueryClient().clear()
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
        render={
          <UserAvatarButton
            avatar={chip.avatar}
            name={chip.name}
            aria-label={`Open account menu for ${chip.name}`}
          />
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-[220px]">
        <div className="flex flex-col gap-0.5 px-3 py-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {primaryLabel}
          </span>
          {email ? (
            <span className="truncate text-xs text-foreground-faint">
              {email}
            </span>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onSignOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserAvatarSkeleton() {
  return (
    <div
      data-slot="user-avatar-skeleton"
      className="inline-flex size-9 shrink-0"
      aria-hidden
    >
      <Skeleton className="size-9 rounded-lg" />
    </div>
  )
}
