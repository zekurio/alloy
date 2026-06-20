import { t as tx } from "@alloy/i18n"
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
import { UserAvatarButton } from "@alloy/ui/components/user-avatar-button"
import { buttonVariants } from "@alloy/ui/lib/button-variants"
import { toast } from "@alloy/ui/lib/toast"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import {
  ChevronDownIcon,
  LogInIcon,
  LogOutIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react"
import * as React from "react"

import { StorageQuotaCompact } from "@/components/storage-quota"
import { completeSignOutFlow, reportAuthFlowFailure } from "@/lib/auth-flow"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useOpenSettings } from "@/lib/use-open-settings"
import { useUserChipData } from "@/lib/user-display"

type UserMenuVariant = "compact" | "rail"

export function UserMenu({
  variant = "compact",
}: {
  variant?: UserMenuVariant
}) {
  return (
    <React.Suspense fallback={<UserAvatarSkeleton variant={variant} />}>
      <UserMenuInner variant={variant} />
    </React.Suspense>
  )
}

function UserMenuInner({ variant }: { variant: UserMenuVariant }) {
  const session = useSuspenseSession()
  const router = useRouter()
  const navigate = useNavigate()
  const openSettings = useOpenSettings()
  const chip = useUserChipData(session?.user)

  if (!session) {
    return (
      <Link
        to="/login"
        className={buttonVariants({
          variant: "ghost",
          size: "sm",
          className: variant === "rail" ? "w-full justify-start" : undefined,
        })}
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
  const accountMenuLabel = tx("Open account menu for {name}", {
    name: chip.name,
  })
  async function onSignOut() {
    try {
      await completeSignOutFlow({
        invalidateRouter: () => router.invalidate(),
        navigate: () => navigate({ to: "/login", replace: true }),
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
          variant === "rail" ? (
            <button
              type="button"
              aria-label={accountMenuLabel}
              className="group text-foreground-muted hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring data-popup-open:bg-surface-raised flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="inline-flex shrink-0">
                <Avatar size="nav" style={avatarTint(chip.avatar)}>
                  {chip.avatar.src ? (
                    <AvatarImage src={chip.avatar.src} alt="" />
                  ) : null}
                  <AvatarFallback style={avatarTint(chip.avatar)}>
                    {chip.avatar.initials}
                  </AvatarFallback>
                </Avatar>
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-foreground truncate text-sm font-semibold">
                  {primaryLabel}
                </span>
                {email ? (
                  <span className="text-foreground-faint truncate text-xs">
                    {email}
                  </span>
                ) : null}
              </span>
              <ChevronDownIcon className="text-foreground-faint size-4 shrink-0 transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)] group-data-popup-open:rotate-180" />
            </button>
          ) : (
            <UserAvatarButton
              avatar={chip.avatar}
              name={chip.name}
              size="nav"
              aria-label={accountMenuLabel}
            />
          )
        }
      />
      <DropdownMenuContent
        align={variant === "rail" ? "start" : "end"}
        side={variant === "rail" ? "top" : "bottom"}
        sideOffset={6}
        className={
          variant === "rail"
            ? "alloy-blur text-foreground w-(--anchor-width) border-white/8"
            : "alloy-blur text-foreground min-w-[220px] border-white/8"
        }
      >
        {variant === "compact" ? (
          <>
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
          </>
        ) : null}
        {handle ? (
          <DropdownMenuItem
            render={<Link to="/u/$username" params={{ username: handle }} />}
          >
            <UserIcon />
            {tx("Profile")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={openSettings}>
          <SettingsIcon />
          {tx("Settings")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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

function avatarTint(avatar: { bg?: string; fg?: string }) {
  return {
    background: avatar.bg ?? "var(--neutral-200)",
    color: avatar.fg ?? "var(--foreground)",
  }
}

function UserAvatarSkeleton({ variant }: { variant: UserMenuVariant }) {
  return (
    <UserAvatarSkeletonFrame
      className={
        variant === "rail"
          ? "flex h-11 w-full items-center gap-2.5 px-2"
          : "inline-flex size-8 shrink-0 items-center justify-center"
      }
    />
  )
}

function UserAvatarSkeletonFrame({ className }: { className: string }) {
  return (
    <div data-slot="user-avatar-skeleton" className={className} aria-hidden>
      <Spinner className="size-4" />
    </div>
  )
}
