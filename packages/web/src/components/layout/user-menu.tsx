import { t as tx } from "@alloy/i18n"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { Spinner } from "@alloy/ui/components/spinner"
import { UserAvatarButton } from "@alloy/ui/components/user-avatar-button"
import { buttonVariants } from "@alloy/ui/lib/button-variants"
import { toast } from "@alloy/ui/lib/toast"
import { Link, useRouter } from "@tanstack/react-router"
import { LogInIcon, LogOutIcon, UserIcon } from "lucide-react"
import * as React from "react"

import { StorageQuotaCompact } from "@/components/storage-quota"
import { completeSignOutFlow, reportAuthFlowFailure } from "@/lib/auth-flow"
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
  const chip = useUserChipData(session?.user)

  if (!session) {
    return (
      <Link
        to="/login"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <LogInIcon />
        {tx("Sign in")}
      </Link>
    )
  }

  const user = session.user
  const handle = user.username ?? user.displayUsername ?? null
  const email = user.email ?? null
  const primaryLabel = handle ? `@${handle}` : chip.name
  async function onSignOut() {
    try {
      await completeSignOutFlow({
        invalidateRouter: () => router.invalidate(),
      })
    } catch (cause) {
      toast.error(
        reportAuthFlowFailure("sign-out", tx("Couldn't sign out"), cause),
      )
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <UserAvatarButton
            avatar={chip.avatar}
            name={chip.name}
            size="nav"
            aria-label={tx("Open account menu for {name}", {
              name: chip.name,
            })}
          />
        }
      />
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="alloy-blur text-foreground min-w-[220px] border-white/8"
      >
        <div className="flex flex-col gap-0.5 px-3 py-2">
          <span className="text-foreground truncate text-sm font-semibold">
            {primaryLabel}
          </span>
          {email ? (
            <span className="text-foreground-faint truncate text-xs">
              {email}
            </span>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {handle ? (
          <>
            <DropdownMenuItem
              render={<Link to="/u/$username" params={{ username: handle }} />}
            >
              <UserIcon />
              {tx("Profile")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <div className="px-3 py-2">
          <StorageQuotaCompact />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onSignOut}>
          <LogOutIcon />
          {tx("Sign out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserAvatarSkeleton() {
  return (
    <div
      data-slot="user-avatar-skeleton"
      className="inline-flex size-8 shrink-0 items-center justify-center"
      aria-hidden
    >
      <Spinner className="size-4" />
    </div>
  )
}
