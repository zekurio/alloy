import {
  getClientLocale,
  LOCALE_LABELS,
  normalizeLocale,
  setClientLocale,
  SUPPORTED_LOCALES,
  t,
  type Locale,
} from "@alloy/i18n"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import {
  getStoredTheme,
  setStoredTheme,
  THEMES,
  THEME_STORAGE_KEY,
  type Theme,
} from "@alloy/ui/lib/theme"
import { refreshThemePreferences } from "@alloy/ui/lib/theme-storage"
import {
  DatabaseIcon,
  FilmIcon,
  Gamepad2Icon,
  LanguagesIcon,
  KeyRoundIcon,
  type LucideIcon,
  PaletteIcon,
  ServerIcon,
  SlidersHorizontalIcon,
  UserIcon,
  UsersIcon,
  VideoIcon,
  Volume2Icon,
  WebhookIcon,
} from "lucide-react"
import { lazy, useEffect, useMemo, useState } from "react"
import type { ComponentType, LazyExoticComponent } from "react"

import { ClipAnnouncementRow } from "@/components/routes/settings/clip-announcement-settings"
import { DangerZoneCard } from "@/components/routes/settings/danger-zone-card"
import {
  ClipDataCard,
  StorageUsageCard,
} from "@/components/routes/settings/data-card"
import { ProfileCard } from "@/components/routes/settings/profile-card"
import { SecuritySettings } from "@/components/routes/settings/security-settings"
import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"
import {
  settingsSearchCategories,
  type SettingsCategoryId,
  type SettingsGroup,
  type SettingsSearchCategory,
} from "@/components/routes/settings/settings-search"
import { ThemeSettings } from "@/components/routes/settings/theme-settings"
import { useIsAdmin, useRequireAuthStrict } from "@/lib/auth-hooks"
import { alloyDesktop } from "@/lib/desktop"

export type { SettingsGroup } from "@/components/routes/settings/settings-search"

type SettingsPanelComponent = ComponentType | LazyExoticComponent<ComponentType>

export interface SettingsCategory extends SettingsSearchCategory {
  icon: LucideIcon
  Panel: SettingsPanelComponent
}

export const SETTINGS_GROUPS: { id: SettingsGroup; label: string }[] = [
  { id: "account", label: t("Settings") },
  { id: "desktop", label: t("Desktop") },
  { id: "admin", label: t("Administration") },
]

const DesktopCapturePanel = lazy(() =>
  import("@/components/routes/settings/desktop/desktop-capture-settings").then(
    (module) => ({
      default: module.DesktopCapturePanel,
    }),
  ),
)

const DesktopQualitySettings = lazy(() =>
  import("@/components/routes/settings/desktop/desktop-quality-settings").then(
    (module) => ({
      default: module.DesktopQualitySettings,
    }),
  ),
)

const DesktopAudioSettings = lazy(() =>
  import("@/components/routes/settings/desktop/desktop-audio-settings").then(
    (module) => ({
      default: module.DesktopAudioSettings,
    }),
  ),
)

const DesktopAppPanel = lazy(() =>
  import("@/components/routes/settings/desktop/desktop-server-settings").then(
    (module) => ({
      default: module.DesktopAppPanel,
    }),
  ),
)

const AdminAppearancePanel = lazy(() =>
  import("@/components/routes/settings/admin-tab-content").then((module) => ({
    default: module.AdminAppearancePanel,
  })),
)

const AdminAuthPanel = lazy(() =>
  import("@/components/routes/settings/admin-tab-content").then((module) => ({
    default: module.AdminAuthPanel,
  })),
)

const AdminTranscodingPanel = lazy(() =>
  import("@/components/routes/settings/admin-tab-content").then((module) => ({
    default: module.AdminTranscodingPanel,
  })),
)

const AdminUsersPanel = lazy(() =>
  import("@/components/routes/settings/admin-tab-content").then((module) => ({
    default: module.AdminUsersPanel,
  })),
)

const AdminGamesPanel = lazy(() =>
  import("@/components/routes/settings/admin-tab-content").then((module) => ({
    default: module.AdminGamesPanel,
  })),
)

const AdminWebhooksPanel = lazy(() =>
  import("@/components/routes/settings/admin-tab-content").then((module) => ({
    default: module.AdminWebhooksPanel,
  })),
)

function ProfilePanel() {
  const session = useRequireAuthStrict()
  const user = session?.user
  if (!user) return null
  // SAFETY: The auth API includes the optional banner field on session users.
  const banner = (user as { banner?: string | null }).banner ?? ""
  return (
    <SettingsSections>
      <SettingsSubsection
        id="identity"
        title={t("Identity")}
        description={t("How you appear to everyone else on this server.")}
      >
        <ProfileCard
          key={user.id}
          userId={user.id}
          initialUsername={user.username ?? ""}
          initialDisplayName={user.displayName ?? ""}
          image={user.image ?? ""}
          banner={banner}
        />
      </SettingsSubsection>
      <SecuritySettings />
    </SettingsSections>
  )
}

function AccountDataPanel() {
  return (
    <SettingsSections>
      <SettingsSubsection
        id="storage"
        title={t("Storage")}
        description={t("How much of your quota your clips are using.")}
      >
        <StorageUsageCard />
      </SettingsSubsection>
      <SettingsSubsection id="clips" title={t("Clips")}>
        <ClipDataCard />
      </SettingsSubsection>
      <SettingsSubsection
        id="danger-zone"
        title={t("Danger zone")}
        description={t("Actions here affect your whole account.")}
      >
        <DangerZoneCard />
      </SettingsSubsection>
    </SettingsSections>
  )
}

const THEME_LABELS = {
  system: t("System"),
  light: t("Light"),
  dark: t("Dark"),
} satisfies Record<Theme, string>

function AppearancePanel() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())

  useEffect(() => {
    const syncStoredTheme = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) {
        refreshThemePreferences()
        setTheme(getStoredTheme())
      }
    }
    window.addEventListener("storage", syncStoredTheme)
    return () => window.removeEventListener("storage", syncStoredTheme)
  }, [])

  function changeTheme(value: string | null) {
    if (value !== "system" && value !== "light" && value !== "dark") return
    setTheme(value)
    setStoredTheme(value)
  }

  return (
    <SettingsSections>
      <SettingsSubsection id="color-mode" title={t("Color mode")}>
        <SettingRows>
          <SettingRow
            title={t("Appearance")}
            description={t("Follow the system or keep Alloy light or dark.")}
            htmlFor="color-mode-select"
          >
            <Select value={theme} onValueChange={changeTheme}>
              <SelectTrigger id="color-mode-select" size="sm" className="w-40">
                <SelectValue>{THEME_LABELS[theme]}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {THEMES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {THEME_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingRows>
      </SettingsSubsection>
      <ThemeSettings />
    </SettingsSections>
  )
}

function PreferencesPanel() {
  const [locale, setLocale] = useState<Locale>(() => getClientLocale())

  function changeLocale(value: string | null) {
    const nextLocale = normalizeLocale(value)
    if (!nextLocale || nextLocale === locale) return
    setLocale(nextLocale)
    setClientLocale(nextLocale)
    window.location.reload()
  }

  return (
    <SettingsSections>
      <SettingsSubsection id="preferences" title={t("Preferences")}>
        <SettingRows>
          <SettingRow
            title={t("Language")}
            description={t("Choose the language used by Alloy.")}
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
          <ClipAnnouncementRow />
        </SettingRows>
      </SettingsSubsection>
    </SettingsSections>
  )
}

const CATEGORY_PANELS = {
  profile: { icon: UserIcon, Panel: ProfilePanel },
  "personal-appearance": { icon: PaletteIcon, Panel: AppearancePanel },
  preferences: { icon: LanguagesIcon, Panel: PreferencesPanel },
  account: { icon: DatabaseIcon, Panel: AccountDataPanel },
  desktop: { icon: VideoIcon, Panel: DesktopCapturePanel },
  "desktop-quality": {
    icon: SlidersHorizontalIcon,
    Panel: DesktopQualitySettings,
  },
  "desktop-audio": { icon: Volume2Icon, Panel: DesktopAudioSettings },
  "desktop-app": { icon: ServerIcon, Panel: DesktopAppPanel },
  appearance: { icon: PaletteIcon, Panel: AdminAppearancePanel },
  authentication: { icon: KeyRoundIcon, Panel: AdminAuthPanel },
  transcoding: { icon: FilmIcon, Panel: AdminTranscodingPanel },
  users: { icon: UsersIcon, Panel: AdminUsersPanel },
  games: { icon: Gamepad2Icon, Panel: AdminGamesPanel },
  webhooks: { icon: WebhookIcon, Panel: AdminWebhooksPanel },
} satisfies Record<
  SettingsCategoryId,
  { icon: LucideIcon; Panel: SettingsPanelComponent }
>

const ALL_CATEGORIES: SettingsCategory[] = settingsSearchCategories().map(
  (category) => ({ ...category, ...CATEGORY_PANELS[category.id] }),
)

/** The default category opened when the dialog is opened without a section. */
export const DEFAULT_SETTINGS_SECTION = "profile"

/** Visible categories for the current user, in nav order. */
export function useSettingsCategories(): SettingsCategory[] {
  const isAdmin = useIsAdmin()
  const hasDesktop = alloyDesktop() !== null
  return useMemo(
    () =>
      ALL_CATEGORIES.filter((category) => {
        if (category.group === "admin") return isAdmin
        if (category.group === "desktop") return hasDesktop
        return true
      }),
    [hasDesktop, isAdmin],
  )
}
