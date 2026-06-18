import {
  getClientLocale,
  LOCALE_LABELS,
  normalizeLocale,
  setClientLocale,
  SUPPORTED_LOCALES,
  t as tx,
  type Locale,
} from "@alloy/i18n"
import { Section, SectionContent } from "@alloy/ui/components/section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { SettingRow } from "@alloy/ui/components/setting-row"
import {
  AlertTriangleIcon,
  DatabaseIcon,
  HardDriveIcon,
  LanguagesIcon,
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
  { id: "account", label: tx("Settings") },
  { id: "desktop", label: tx("Desktop") },
  { id: "admin", label: tx("Administration") },
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

function PreferencesPanel() {
  const [locale, setLocale] = React.useState<Locale>(() => getClientLocale())

  function changeLocale(value: string | null) {
    const nextLocale = normalizeLocale(value)
    if (!nextLocale || nextLocale === locale) return
    setLocale(nextLocale)
    setClientLocale(nextLocale)
    window.location.reload()
  }

  return (
    <Section>
      <SectionContent>
        <SettingRow
          title={tx("Language")}
          description={tx("Choose the language used by Alloy.")}
          htmlFor="locale"
        >
          <Select value={locale} onValueChange={changeLocale}>
            <SelectTrigger id="locale" size="sm" className="w-40">
              <SelectValue>{LOCALE_LABELS[locale]}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {SUPPORTED_LOCALES.map((option) => (
                <SelectItem key={option} value={option}>
                  {LOCALE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SectionContent>
    </Section>
  )
}

const ALL_CATEGORIES: SettingsCategory[] = [
  {
    id: "profile",
    label: tx("Profile"),
    title: tx("Profile identity"),
    description: tx("Edit your username, email, avatar, and banner."),
    keywords: ["username", "email", "avatar", "profile picture", "banner"],
    icon: UserIcon,
    group: "account",
    Panel: ProfilePanel,
  },
  {
    id: "preferences",
    label: tx("Preferences"),
    title: tx("Preferences"),
    description: tx("Language and regional settings."),
    keywords: ["language", "locale", "settings"],
    icon: LanguagesIcon,
    group: "account",
    Panel: PreferencesPanel,
  },
  {
    id: "security",
    label: tx("Security"),
    title: tx("Sign-in security"),
    description: tx("Manage linked accounts and passkeys for this account."),
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
    label: tx("Clips & storage"),
    description: tx("Review storage usage, download, or remove your clips."),
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
    label: tx("Account"),
    title: tx("Account state"),
    description: tx("Disable this profile or permanently delete the account."),
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
    label: tx("Capture"),
    title: tx("Capture"),
    description: tx("Game detection, desktop capture, hotkeys, and sounds."),
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
    label: tx("Quality"),
    title: tx("Quality"),
    description: tx("Resolution, frame rate, encoder, and replay buffer."),
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
    label: tx("Audio"),
    title: tx("Audio"),
    description: tx("Devices, microphones, application streams, and volumes."),
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
    label: tx("Storage"),
    title: tx("Capture storage"),
    description: tx(
      "Choose where clips are saved and review local disk usage.",
    ),
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
    label: tx("Servers"),
    title: tx("Servers"),
    description: tx("Add, switch between, or forget connected Alloy servers."),
    keywords: ["desktop servers", "switch server", "saved servers"],
    icon: ServerIcon,
    group: "desktop",
    Panel: DesktopServerSettings,
  },
  {
    id: "desktop-updates",
    label: tx("Updates"),
    title: tx("Updates"),
    description: tx("Switch stable or nightly desktop releases."),
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
    label: tx("Appearance"),
    title: tx("Login appearance"),
    description: tx(
      "Edit the generated clip backdrop shown on the login page.",
    ),
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
    label: tx("Users"),
    description: tx("Edit user accounts, roles, and moderation state."),
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
