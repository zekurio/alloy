import { t } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { Spinner } from "@alloy/ui/components/spinner"
import { buttonVariants } from "@alloy/ui/lib/button-variants"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import {
  ChevronDownIcon,
  LogInIcon,
  LogOutIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react"
import { Suspense } from "react"

import { StorageQuotaCompact } from "@/components/storage-quota"
import { completeSignOutFlow, reportAuthFlowFailure } from "@/lib/auth-flow"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useOpenSettings } from "@/lib/use-open-settings"
import { useUserChipData } from "@/lib/user-display"

/**
 * Header account entry point: avatar + display name (or handle) + chevron,
 * opening a downward account menu. Signed-out sessions render a sign-in link
 * in the same slot.
 */
export function UserMenu({ className }: { className?: string }) {
  return (
    <Suspense fallback={<UserMenuSkeleton className={className} />}>
      <UserMenuInner className={className} />
    </Suspense>
  )
}

function UserMenuInner({ className }: { className?: string }) {
  const session = useSuspenseSession()
  const router = useRouter()
  const navigate = useNavigate()
  const openSettings = useOpenSettings()
  const chip = useUserChipData(session?.user)

  if (!session) {
    return (
      <Link
        to="/login"
        className={buttonVariants({ variant: "ghost", size: "sm", className })}
      >
        <LogInIcon />
        {t("Sign in")}
      </Link>
    )
  }

  const user = session.user
  const handle = user.username ?? null
  // chip.name already resolves display name → handle, so the trigger shows a
  // single label; the menu header adds the @handle when it differs.
  const primaryLabel = chip.name
  const secondaryLabel = handle && handle !== primaryLabel ? handle : null
  async function onSignOut() {
    try {
      await completeSignOutFlow({
        invalidateRouter: () => router.invalidate(),
        navigate: () => navigate({ to: "/login", replace: true }),
      })
    } catch (cause) {
      toast.error(
        reportAuthFlowFailure("sign-out", t("Couldn't sign out"), cause),
      )
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t("Open account menu for {name}", { name: chip.name })}
            className={cn(
              "group flex h-9 max-w-52 min-w-0 items-center gap-2 rounded-md px-1.5",
              "hover:bg-surface-raised data-popup-open:bg-surface-raised",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              className,
            )}
          >
            <Avatar
              size="nav"
              className="shrink-0"
              style={avatarTint(chip.avatar)}
            >
              {chip.avatar.src ? (
                <AvatarImage src={chip.avatar.src} alt="" />
              ) : null}
              <AvatarFallback style={avatarTint(chip.avatar)}>
                {chip.avatar.initials}
              </AvatarFallback>
            </Avatar>
            <span className="text-foreground min-w-0 truncate text-sm font-semibold">
              {primaryLabel}
            </span>
            <ChevronDownIcon className="text-foreground-faint size-4 shrink-0 transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)] group-data-popup-open:rotate-180" />
          </button>
        }
      />
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={6}
        className="alloy-blur text-foreground min-w-[220px] border-white/8"
      >
        <div className="flex flex-col gap-0.5 px-3 py-2">
          <span className="text-foreground truncate text-sm font-semibold">
            {primaryLabel}
          </span>
          {secondaryLabel ? (
            <span className="text-foreground-faint truncate text-xs">
              @{secondaryLabel}
            </span>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {handle ? (
          <DropdownMenuItem
            render={<Link to="/u/$username" params={{ username: handle }} />}
          >
            <UserIcon />
            {t("Profile")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={openSettings}>
          <SettingsIcon />
          {t("Settings")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-3 py-2">
          <StorageQuotaCompact />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onSignOut}>
          <LogOutIcon />
          {t("Sign out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function avatarTint(avatar: { bg?: string; fg?: string }) {
  return {
    background: avatar.bg ?? "var(--neutral-200)",
    color: avatar.fg ?? "var(--foreground)",
  }
}

function UserMenuSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="user-menu-skeleton"
      className={cn(
        "flex h-9 w-24 items-center justify-center gap-2 rounded-md",
        className,
      )}
      aria-hidden
    >
      <Spinner className="size-4" />
    </div>
  )
}
