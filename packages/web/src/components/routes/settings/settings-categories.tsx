import {
  AlertTriangleIcon,
  DatabaseIcon,
  HardDriveIcon,
  RefreshCcwIcon,
  type LucideIcon,
  PaletteIcon,
  ServerIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  UserIcon,
  UsersIcon,
  VideoIcon,
  Volume2Icon,
} from "lucide-react"
import * as React from "react"

import {
  AdminAppearancePanel,
  AdminUsersPanel,
} from "@/components/routes/settings/admin-tab-content"
import { DangerZoneCard } from "@/components/routes/settings/danger-zone-card"
import {
  ClipDataCard,
  StorageUsageCard,
} from "@/components/routes/settings/data-card"
import { DesktopAudioSettings } from "@/components/routes/settings/desktop/desktop-audio-settings"
import {
  DesktopCaptureSettings,
  DesktopStoragePanel,
} from "@/components/routes/settings/desktop/desktop-capture-settings"
import { DesktopQualitySettings } from "@/components/routes/settings/desktop/desktop-quality-settings"
import { DesktopServerSettings } from "@/components/routes/settings/desktop/desktop-server-settings"
import { DesktopUpdateSettings } from "@/components/routes/settings/desktop/desktop-update-settings"
import { ProfileCard } from "@/components/routes/settings/profile-card"
import { SecuritySettings } from "@/components/routes/settings/security-settings"
import { useIsAdmin, useRequireAuthStrict } from "@/lib/auth-hooks"
import { alloyDesktop } from "@/lib/desktop"

export type SettingsGroup = "account" | "desktop" | "admin"

export interface SettingsCategory {
  id: string
  /** Short label shown in the sidebar nav. */
  label: string
  /** Heading shown above the panel content. Defaults to `label`. */
  title?: string
  description?: string
  /**
   * Names of the individual options inside this panel, so the settings search
   * can surface a tab by the controls it contains (e.g. "codec", "passkeys"),
   * not just by its label.
   */
  keywords?: string[]
  icon: LucideIcon
  group: SettingsGroup
  Panel: React.ComponentType
}

export const SETTINGS_GROUPS: { id: SettingsGroup; label: string }[] = [
  { id: "account", label: "Settings" },
  { id: "desktop", label: "Desktop" },
  { id: "admin", label: "Administration" },
]

function ProfilePanel() {
  const session = useRequireAuthStrict()
  const user = session?.user
  if (!user) return null
  return (
    <ProfileCard
      key={user.id}
      userId={user.id}
      initialUsername={user.username ?? ""}
      image={user.image ?? ""}
      banner={(user as { banner?: string | null }).banner ?? ""}
      email={user.email ?? ""}
    />
  )
}

function StoragePanel() {
  return (
    <div className="flex flex-col gap-4">
      <StorageUsageCard />
      <hr className="border-border" />
      <ClipDataCard />
    </div>
  )
}

const ALL_CATEGORIES: SettingsCategory[] = [
  {
    id: "profile",
    label: "Profile",
    title: "Profile identity",
    description: "Edit your username, email, avatar, and banner.",
    keywords: ["username", "email", "avatar", "profile picture", "banner"],
    icon: UserIcon,
    group: "account",
    Panel: ProfilePanel,
  },
  {
    id: "security",
    label: "Security",
    title: "Sign-in security",
    description: "Manage linked accounts and passkeys for this account.",
    keywords: [
      "passkeys",
      "linked accounts",
      "connected accounts",
      "oauth",
      "sign-in methods",
    ],
    icon: ShieldIcon,
    group: "account",
    Panel: SecuritySettings,
  },
  {
    id: "storage",
    label: "Clips & storage",
    description: "Review storage usage, download, or remove your clips.",
    keywords: [
      "storage usage",
      "quota",
      "download clips",
      "delete clips",
      "export data",
    ],
    icon: DatabaseIcon,
    group: "account",
    Panel: StoragePanel,
  },
  {
    id: "account",
    label: "Account",
    title: "Account state",
    description: "Disable this profile or permanently delete the account.",
    keywords: [
      "disable account",
      "deactivate",
      "delete account",
      "danger zone",
    ],
    icon: AlertTriangleIcon,
    group: "account",
    Panel: DangerZoneCard,
  },
  {
    id: "desktop",
    label: "Capture",
    title: "Capture",
    description: "Game detection, desktop capture, hotkeys, and sounds.",
    keywords: [
      "desktop app",
      "recording",
      "replay buffer",
      "save hotkey",
      "long recordings",
      "desktop capture",
      "game detection",
      "manual overrides",
      "notification sounds",
      "sound effect",
    ],
    icon: VideoIcon,
    group: "desktop",
    Panel: DesktopCaptureSettings,
  },
  {
    id: "desktop-quality",
    label: "Quality",
    title: "Quality",
    description: "Resolution, frame rate, encoder, and replay buffer.",
    keywords: [
      "quality",
      "resolution",
      "frame rate",
      "fps",
      "bitrate",
      "codec",
      "encoder",
      "gpu",
      "replay buffer",
    ],
    icon: SlidersHorizontalIcon,
    group: "desktop",
    Panel: DesktopQualitySettings,
  },
  {
    id: "desktop-audio",
    label: "Audio",
    title: "Audio",
    description: "Devices, microphones, application streams, and volumes.",
    keywords: [
      "audio",
      "output devices",
      "input devices",
      "microphone",
      "speakers",
      "volume",
      "applications",
    ],
    icon: Volume2Icon,
    group: "desktop",
    Panel: DesktopAudioSettings,
  },
  {
    id: "desktop-storage",
    label: "Storage",
    title: "Capture storage",
    description: "Choose where clips are saved and review local disk usage.",
    keywords: [
      "capture folder",
      "disk usage",
      "storage",
      "free space",
      "clips folder",
    ],
    icon: HardDriveIcon,
    group: "desktop",
    Panel: DesktopStoragePanel,
  },
  {
    id: "desktop-servers",
    label: "Servers",
    title: "Servers",
    description: "Add, switch between, or forget connected Alloy servers.",
    keywords: ["desktop servers", "switch server", "saved servers"],
    icon: ServerIcon,
    group: "desktop",
    Panel: DesktopServerSettings,
  },
  {
    id: "desktop-updates",
    label: "Updates",
    title: "Updates",
    description: "Switch stable or nightly desktop releases.",
    keywords: [
      "updates",
      "update channel",
      "stable",
      "latest",
      "nightly",
      "release channel",
    ],
    icon: RefreshCcwIcon,
    group: "desktop",
    Panel: DesktopUpdateSettings,
  },
  {
    id: "appearance",
    label: "Appearance",
    title: "Login appearance",
    description: "Edit the generated clip backdrop shown on the login page.",
    keywords: [
      "login backdrop",
      "splash",
      "blur",
      "darkening",
      "custom backdrop",
      "regenerate",
    ],
    icon: PaletteIcon,
    group: "admin",
    Panel: AdminAppearancePanel,
  },
  {
    id: "users",
    label: "Users",
    description: "Edit user accounts, roles, and moderation state.",
    keywords: ["user accounts", "roles", "moderation", "ban", "storage quota"],
    icon: UsersIcon,
    group: "admin",
    Panel: AdminUsersPanel,
  },
]

/** The default category opened when the dialog is opened without a section. */
export const DEFAULT_SETTINGS_SECTION = "profile"

/** Visible categories for the current user, in nav order. */
export function useSettingsCategories(): SettingsCategory[] {
  const isAdmin = useIsAdmin()
  const hasDesktop = alloyDesktop() !== null
  return React.useMemo(
    () =>
      ALL_CATEGORIES.filter((category) => {
        if (category.group === "admin") return isAdmin
        if (category.group === "desktop") return hasDesktop
        return true
      }),
    [hasDesktop, isAdmin],
  )
}
