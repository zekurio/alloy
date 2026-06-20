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

type SettingsCategoryDraft = Omit<SettingsCategory, "group">
type SettingsCategorySpec = readonly [
  id: string,
  label: string,
  title: string | null,
  description: string,
  keywords: string[],
  icon: LucideIcon,
  Panel: React.ComponentType,
]

export const SETTINGS_GROUPS: { id: SettingsGroup; label: string }[] = [
  { id: "account", label: tx("Settings") },
  { id: "desktop", label: tx("Desktop") },
  { id: "admin", label: tx("Administration") },
]

function withSettingsGroup(
  group: SettingsGroup,
  categories: SettingsCategoryDraft[],
): SettingsCategory[] {
  return categories.map((category) => ({ ...category, group }))
}

function categoryDrafts(
  specs: readonly SettingsCategorySpec[],
): SettingsCategoryDraft[] {
  return specs.map(([id, label, title, description, keywords, icon, Panel]) => {
    const category: SettingsCategoryDraft = {
      id,
      label,
      description,
      keywords,
      icon,
      Panel,
    }
    if (title !== null) category.title = title
    return category
  })
}

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

const ACCOUNT_CATEGORIES = categoryDrafts([
  [
    "profile",
    tx("Profile"),
    tx("Profile identity"),
    tx("Edit your username, email, avatar, and banner."),
    ["username", "email", "avatar", "profile picture", "banner"],
    UserIcon,
    ProfilePanel,
  ],
  [
    "preferences",
    tx("Preferences"),
    tx("Preferences"),
    tx("Language and regional settings."),
    ["language", "locale", "settings"],
    LanguagesIcon,
    PreferencesPanel,
  ],
  [
    "security",
    tx("Security"),
    tx("Sign-in security"),
    tx("Manage linked accounts and passkeys for this account."),
    [
      "passkeys",
      "linked accounts",
      "connected accounts",
      "oauth",
      "sign-in methods",
    ],
    ShieldIcon,
    SecuritySettings,
  ],
  [
    "storage",
    tx("Clips & storage"),
    null,
    tx("Review storage usage, download, or remove your clips."),
    ["storage usage", "quota", "download clips", "delete clips", "export data"],
    DatabaseIcon,
    StoragePanel,
  ],
  [
    "account",
    tx("Account"),
    tx("Account state"),
    tx("Disable this profile or permanently delete the account."),
    ["disable account", "deactivate", "delete account", "danger zone"],
    AlertTriangleIcon,
    DangerZoneCard,
  ],
])

const DESKTOP_CATEGORIES = categoryDrafts([
  [
    "desktop",
    tx("Capture"),
    tx("Capture"),
    tx("Game detection, desktop capture, hotkeys, and sounds."),
    [
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
    VideoIcon,
    DesktopCaptureSettings,
  ],
  [
    "desktop-quality",
    tx("Quality"),
    tx("Quality"),
    tx("Resolution, frame rate, encoder, and replay buffer."),
    [
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
    SlidersHorizontalIcon,
    DesktopQualitySettings,
  ],
  [
    "desktop-audio",
    tx("Audio"),
    tx("Audio"),
    tx("Devices, microphones, application streams, and volumes."),
    [
      "audio",
      "output devices",
      "input devices",
      "microphone",
      "speakers",
      "volume",
      "applications",
    ],
    Volume2Icon,
    DesktopAudioSettings,
  ],
  [
    "desktop-storage",
    tx("Storage"),
    tx("Capture storage"),
    tx("Choose where clips are saved and review local disk usage."),
    ["capture folder", "disk usage", "storage", "free space", "clips folder"],
    HardDriveIcon,
    DesktopStoragePanel,
  ],
  [
    "desktop-servers",
    tx("Servers"),
    tx("Servers"),
    tx("Add, switch between, or forget connected Alloy servers."),
    ["desktop servers", "switch server", "saved servers"],
    ServerIcon,
    DesktopServerSettings,
  ],
  [
    "desktop-updates",
    tx("Updates"),
    tx("Updates"),
    tx("Switch stable or nightly desktop releases."),
    [
      "updates",
      "update channel",
      "stable",
      "latest",
      "nightly",
      "release channel",
    ],
    RefreshCcwIcon,
    DesktopUpdateSettings,
  ],
])

const ADMIN_CATEGORIES = categoryDrafts([
  [
    "appearance",
    tx("Appearance"),
    tx("Login appearance"),
    tx("Edit the generated clip backdrop shown on the login page."),
    [
      "login backdrop",
      "splash",
      "blur",
      "darkening",
      "custom backdrop",
      "regenerate",
    ],
    PaletteIcon,
    AdminAppearancePanel,
  ],
  [
    "users",
    tx("Users"),
    null,
    tx("Edit user accounts, roles, and moderation state."),
    ["user accounts", "roles", "moderation", "ban", "storage quota"],
    UsersIcon,
    AdminUsersPanel,
  ],
])

const ALL_CATEGORIES: SettingsCategory[] = [
  ...withSettingsGroup("account", ACCOUNT_CATEGORIES),
  ...withSettingsGroup("desktop", DESKTOP_CATEGORIES),
  ...withSettingsGroup("admin", ADMIN_CATEGORIES),
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
