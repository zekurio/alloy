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
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import {
  GamepadIcon,
  HomeIcon,
  LibraryIcon,
  LogInIcon,
  LogOutIcon,
  PlusIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react"
import * as React from "react"

import { StorageQuotaCompact } from "@/components/storage-quota"
import { completeSignOutFlow, reportAuthFlowFailure } from "@/lib/auth-flow"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useOpenSettings } from "@/lib/use-open-settings"
import { useUserChipData } from "@/lib/user-display"

import { useCreateActions } from "./create-actions"
import { useNavFlags } from "./use-nav-flags"

/**
 * Mobile primary navigation: a fixed bottom tab bar with the four core
 * destinations plus a centered upload button. Hidden on md+, where the sidebar
 * rail and floating create button take over. The profile tab opens a floating
 * account menu (settings, storage, sign out) rather than navigating.
 */
export function MobileBottomNav() {
  const { isHome, isGames, isLibrary } = useNavFlags()

  return (
    <nav
      aria-label={tx("Primary")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        "border-border bg-surface border-t",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <div className="grid h-[var(--bottomnav-h)] grid-cols-5 items-stretch">
        <BottomNavLink
          to="/"
          active={isHome}
          label={tx("Home")}
          icon={<HomeIcon />}
        />
        <BottomNavLink
          to="/library"
          active={isLibrary}
          label={tx("Library")}
          icon={<LibraryIcon />}
        />
        <UploadTab />
        <BottomNavLink
          to="/games"
          active={isGames}
          label={tx("Games")}
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
  icon: React.ReactNode
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

/** Centered upload entry — a compact accent button that sits within the bar. */
function UploadTab() {
  const { uploadLabel, uploadDisabled, startUpload } = useCreateActions()

  return (
    <div className="flex items-center justify-center">
      <button
        type="button"
        data-upload-trigger=""
        disabled={uploadDisabled}
        onClick={startUpload}
        aria-label={uploadLabel || tx("Upload")}
        title={uploadLabel || tx("Upload")}
        className={cn(
          "bg-accent text-accent-foreground grid size-11 place-items-center rounded-full",
          "shadow-[0_6px_18px_-8px_var(--accent-glow)]",
          "transition-[transform,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "hover:bg-accent-hover active:scale-95",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-50",
          "[&_svg]:size-6",
        )}
      >
        <PlusIcon />
      </button>
    </div>
  )
}

/** Profile tab — opens a floating account menu anchored above the bar. */
function ProfileTab() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" aria-label={tx("Account")} className={tabClass}>
            <React.Suspense fallback={<UserIcon />}>
              <ProfileTabIcon />
            </React.Suspense>
            <span className="max-w-full truncate">{tx("Profile")}</span>
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
        <React.Suspense fallback={<ProfileMenuFallback />}>
          <ProfileMenuItems />
        </React.Suspense>
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
        {tx("Sign in")}
      </DropdownMenuItem>
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
        navigate: () => navigate({ to: "/login", replace: true }),
      })
    } catch (cause) {
      toast.error(
        reportAuthFlowFailure("sign-out", tx("Couldn't sign out"), cause),
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
