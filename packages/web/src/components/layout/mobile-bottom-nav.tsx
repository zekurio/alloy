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
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import {
  GamepadIcon,
  HomeIcon,
  LibraryIcon,
  LogInIcon,
  LogOutIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react"
import { Suspense } from "react"
import type { ReactNode } from "react"

import { StorageQuotaCompact } from "@/components/storage-quota"
import { GlobalUploadControl } from "@/components/upload/global-upload-control"
import { completeSignOutFlow, reportAuthFlowFailure } from "@/lib/auth-flow"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useOpenSettings } from "@/lib/use-open-settings"
import { useUserChipData } from "@/lib/user-display"

import { useNavFlags } from "./use-nav-flags"

/**
 * Mobile primary navigation. Hidden on md+, where the sidebar rail takes over.
 * The profile tab opens a floating account menu (settings, storage, sign out)
 * rather than navigating.
 */
export function MobileBottomNav() {
  const { isHome, isGames, isLibrary } = useNavFlags()
  const session = useSuspenseSession()

  return (
    <nav
      aria-label={t("Primary")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        "border-border bg-surface border-t",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <div
        className={cn(
          "grid h-[var(--bottomnav-h)] items-stretch",
          session ? "grid-cols-5" : "grid-cols-4",
        )}
      >
        <BottomNavLink
          to="/"
          active={isHome}
          label={t("Home")}
          icon={<HomeIcon />}
        />
        <BottomNavLink
          to="/library"
          active={isLibrary}
          label={t("Library")}
          icon={<LibraryIcon />}
        />
        {session ? (
          <div className="flex items-center justify-center">
            <GlobalUploadControl variant="bottom-nav" />
          </div>
        ) : null}
        <BottomNavLink
          to="/games"
          active={isGames}
          label={t("Games")}
          icon={<GamepadIcon />}
        />
        <ProfileTab />
      </div>
    </nav>
  )
}

const tabClass = cn(
  "group/tab relative flex flex-col items-center justify-center gap-1 px-1",
  "[-webkit-tap-highlight-color:transparent]",
  "text-foreground-muted text-[10px] leading-none font-medium",
  "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
  "active:text-accent",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
  "data-active:text-accent data-popup-open:text-accent",
  "[&_svg]:size-[22px]",
)

function BottomNavLink({
  to,
  active,
  label,
  icon,
}: {
  to: "/" | "/library" | "/games"
  active: boolean
  label: string
  icon: ReactNode
}) {
  return (
    <Link
      to={to}
      data-active={active ? "" : undefined}
      aria-current={active ? "page" : undefined}
      className={tabClass}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </Link>
  )
}

/** Profile tab — opens a floating account menu anchored above the bar. */
function ProfileTab() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" aria-label={t("Account")} className={tabClass}>
            <Suspense fallback={<UserIcon />}>
              <ProfileTabIcon />
            </Suspense>
            <span className="max-w-full truncate">{t("Profile")}</span>
          </button>
        }
      />
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={12}
        alignOffset={-12}
        className="alloy-blur text-foreground min-w-[15rem] border-white/8"
      >
        <Suspense fallback={<ProfileMenuFallback />}>
          <ProfileMenuItems />
        </Suspense>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProfileMenuItems() {
  const session = useSuspenseSession()
  const router = useRouter()
  const navigate = useNavigate()
  const openSettings = useOpenSettings()
  const chip = useUserChipData(session?.user)

  if (!session) {
    return (
      <DropdownMenuItem render={<Link to="/login" />}>
        <LogInIcon />
        {t("Sign in")}
      </DropdownMenuItem>
    )
  }

  const user = session.user
  const handle = user.username ?? null
  const email = user.email ?? null
  const primaryLabel = handle ?? chip.name

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
    <>
      <div className="flex items-center gap-3 px-3 py-2">
        <Avatar size="nav" style={avatarTint(chip.avatar)}>
          {chip.avatar.src ? (
            <AvatarImage src={chip.avatar.src} alt="" />
          ) : null}
          <AvatarFallback style={avatarTint(chip.avatar)}>
            {chip.avatar.initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground truncate text-sm font-semibold">
            {primaryLabel}
          </span>
          {email ? (
            <span className="text-foreground-faint truncate text-xs">
              {email}
            </span>
          ) : null}
        </div>
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
    </>
  )
}

function ProfileMenuFallback() {
  return (
    <div className="flex h-12 items-center gap-3 px-3" aria-hidden>
      <Spinner className="size-4" />
    </div>
  )
}

function ProfileTabIcon() {
  const session = useSuspenseSession()
  const chip = useUserChipData(session?.user)

  if (!session) return <UserIcon />

  return (
    <Avatar
      size="sm"
      className="group-data-popup-open/tab:ring-accent ring-1 ring-transparent ring-offset-0"
      style={avatarTint(chip.avatar)}
    >
      {chip.avatar.src ? <AvatarImage src={chip.avatar.src} alt="" /> : null}
      <AvatarFallback className="text-[9px]" style={avatarTint(chip.avatar)}>
        {chip.avatar.initials}
      </AvatarFallback>
    </Avatar>
  )
}

function avatarTint(avatar: { bg?: string; fg?: string }) {
  return {
    background: avatar.bg ?? "var(--neutral-200)",
    color: avatar.fg ?? "var(--foreground)",
  }
}
