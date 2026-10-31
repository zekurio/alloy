import { t } from "@alloy/i18n"
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@alloy/ui/components/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { Spinner } from "@alloy/ui/components/spinner"
import { useIsMobile } from "@alloy/ui/hooks/use-mobile"
import { buttonVariants } from "@alloy/ui/lib/button-variants"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { ChevronDownIcon, LogInIcon } from "lucide-react"
import { Suspense, useState } from "react"

import {
  mobileDrawerContentClass,
  MobileDrawerHandle,
} from "@/components/app/mobile-drawer-surface"
import { useSuspenseSession } from "@/lib/session-suspense"
import { TintedAvatar, userChipData } from "@/lib/user-display"

import { AccountMenuItems, AccountSheetItems } from "./account-menu"
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
  const chip = userChipData(session?.user)
  const isMobile = useIsMobile()
  const [sheetOpen, setSheetOpen] = useState(false)

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
  const trigger = (
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
      <TintedAvatar avatar={chip.avatar} size="nav" className="shrink-0" />
      <span className="min-w-0 truncate text-sm font-medium max-md:hidden">
        {chip.name}
      </span>
      <ChevronDownIcon
        aria-hidden
        className="text-foreground-faint size-4 shrink-0 max-md:hidden"
      />
    </button>
  )

  if (isMobile) {
    // A bottom sheet within thumb reach, like the clip actions sheet, rather
    // than a small menu pinned to the top corner.
    return (
      <Drawer direction="bottom" open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent className={mobileDrawerContentClass}>
          <MobileDrawerHandle />
          <div className="flex items-center gap-3 px-5 pt-3 pb-3">
            <TintedAvatar
              avatar={chip.avatar}
              size="lg"
              className="!size-10 shrink-0"
            />
            <div className="flex min-w-0 flex-col">
              <DrawerTitle className="truncate text-base">
                {primaryLabel}
              </DrawerTitle>
              {secondaryLabel ? (
                <span className="text-foreground-dim truncate text-sm">
                  @{secondaryLabel}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <AccountSheetItems
              handle={handle}
              onClose={() => setSheetOpen(false)}
            />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
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
