import { t } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { Spinner } from "@alloy/ui/components/spinner"
import { buttonVariants } from "@alloy/ui/lib/button-variants"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { ChevronDownIcon, LogInIcon } from "lucide-react"
import { Suspense } from "react"

import { useSuspenseSession } from "@/lib/session-suspense"
import { useUserChipData } from "@/lib/user-display"

import { AccountMenuItems, avatarTint } from "./account-menu"
import { topRightAppCornerAnchor } from "./corner-anchors"

/**
 * Header account entry point. Signed-out sessions render a sign-in link in the
 * same slot.
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
  const chip = useUserChipData(session?.user)

  if (!session) {
    return (
      <Link
        to="/login"
        className={buttonVariants({ variant: "ghost", size: "md", className })}
      >
        <LogInIcon />
        {t("Sign in")}
      </Link>
    )
  }

  const handle = session.user.username ?? null
  // chip.name already resolves display name → handle, so the menu header shows
  // a single label and adds the @handle only when it differs.
  const primaryLabel = chip.name
  const secondaryLabel = handle && handle !== primaryLabel ? handle : null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t("Open account menu for {name}", { name: chip.name })}
            className={cn(
              "flex h-9 max-w-48 shrink-0 items-center gap-2 rounded-full py-0.5 pr-2 pl-0.5 max-md:size-9 max-md:p-0",
              "hover:brightness-110",
              "transition-[filter] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
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
              <AvatarFallback style={avatarTint(chip.avatar)} />
            </Avatar>
            <span className="min-w-0 truncate text-sm font-medium max-md:hidden">
              {chip.name}
            </span>
            <ChevronDownIcon
              aria-hidden
              className="text-foreground-faint size-4 shrink-0 max-md:hidden"
            />
          </button>
        }
      />
      <DropdownMenuContent
        anchor={topRightAppCornerAnchor}
        align="end"
        side="bottom"
        sideOffset={0}
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
        <AccountMenuItems handle={handle} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenuSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="user-menu-skeleton"
      className={cn(
        "flex h-9 w-28 items-center justify-center rounded-full max-md:w-9",
        className,
      )}
      aria-hidden
    >
      <Spinner className="size-4" />
    </div>
  )
}
