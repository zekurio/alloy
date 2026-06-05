import { Link, useRouter } from "@tanstack/react-router"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Spinner } from "@workspace/ui/components/spinner"
import { UserAvatarButton } from "@workspace/ui/components/user-avatar-button"
import { buttonVariants } from "@workspace/ui/lib/button-variants"
import { toast } from "@workspace/ui/lib/toast"
import { LogInIcon, LogOutIcon } from "lucide-react"
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
      await completeSignOutFlow({
        invalidateRouter: () => router.invalidate(),
      })
    } catch (cause) {
      toast.error(reportAuthFlowFailure("sign-out", "Couldn't sign out", cause))
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
        <div className="px-3 py-2">
          <StorageQuotaCompact />
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
      className="inline-flex size-9 shrink-0 items-center justify-center"
      aria-hidden
    >
      <Spinner className="size-4" />
    </div>
  )
}
