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
  type Theme,
} from "@alloy/ui/lib/theme"
import {
  DatabaseIcon,
  FilmIcon,
  Gamepad2Icon,
  LanguagesIcon,
  KeyRoundIcon,
  LogInIcon,
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
import { lazy, useMemo, useState } from "react"
import type { ComponentType, LazyExoticComponent } from "react"

import { ClipAnnouncementRow } from "@/components/routes/settings/clip-announcement-settings"
import { DangerZoneCard } from "@/components/routes/settings/danger-zone-card"
import {
  ClipDataCard,
  StorageUsageCard,
} from "@/components/routes/settings/data-card"
import { ProfileCard } from "@/components/routes/settings/profile-card"
import { SecuritySettings } from "@/components/routes/settings/security-settings"
import { SessionsCard } from "@/components/routes/settings/sessions-card"
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
import {
  ThemeSettings,
  useStoredThemeSync,
} from "@/components/routes/settings/theme-settings"
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

/** Loads a panel from its own chunk the first time it opens. */
function lazyPanel<TModule>(
  load: () => Promise<TModule>,
  pick: (module: TModule) => ComponentType,
) {
  return lazy(async () => ({ default: pick(await load()) }))
}

const loadAdminPanels = () =>
  import("@/components/routes/settings/admin-tab-content")

const DesktopCapturePanel = lazyPanel(
  () => import("@/components/routes/settings/desktop/desktop-capture-settings"),
  (module) => module.DesktopCapturePanel,
)
const DesktopQualitySettings = lazyPanel(
  () => import("@/components/routes/settings/desktop/desktop-quality-settings"),
  (module) => module.DesktopQualitySettings,
)
const DesktopAudioSettings = lazyPanel(
  () => import("@/components/routes/settings/desktop/desktop-audio-settings"),
  (module) => module.DesktopAudioSettings,
)
const DesktopAppPanel = lazyPanel(
  () => import("@/components/routes/settings/desktop/desktop-server-settings"),
  (module) => module.DesktopAppPanel,
)
const AdminAppearancePanel = lazyPanel(
  loadAdminPanels,
  (module) => module.AdminAppearancePanel,
)
const AdminAuthPanel = lazyPanel(
  loadAdminPanels,
  (module) => module.AdminAuthPanel,
)
const AdminUploadLimitsPanel = lazyPanel(
  loadAdminPanels,
  (module) => module.AdminUploadLimitsPanel,
)
const AdminTranscodingPanel = lazyPanel(
  loadAdminPanels,
  (module) => module.AdminTranscodingPanel,
)
const AdminUsersPanel = lazyPanel(
  loadAdminPanels,
  (module) => module.AdminUsersPanel,
)
const AdminGamesPanel = lazyPanel(
  loadAdminPanels,
  (module) => module.AdminGamesPanel,
)
const AdminWebhooksPanel = lazyPanel(
  loadAdminPanels,
  (module) => module.AdminWebhooksPanel,
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
      <SessionsCard />
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

  useStoredThemeSync(() => setTheme(getStoredTheme()))

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
  appearance: { icon: LogInIcon, Panel: AdminAppearancePanel },
  authentication: { icon: KeyRoundIcon, Panel: AdminAuthPanel },
  "upload-limits": {
    icon: SlidersHorizontalIcon,
    Panel: AdminUploadLimitsPanel,
  },
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

/**
 * Section id for "settings, no page in particular". A phone shows the menu of
 * categories for it; wider layouts fall through to the first category.
 */
export const SETTINGS_OVERVIEW_SECTION = "overview"

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
