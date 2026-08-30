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
import { ThemeSettings } from "@/components/routes/settings/theme-settings"
import { useIsAdmin, useRequireAuthStrict } from "@/lib/auth-hooks"
import { alloyDesktop } from "@/lib/desktop"

export type SettingsGroup = "account" | "desktop" | "admin"

type SettingsPanelComponent = ComponentType | LazyExoticComponent<ComponentType>

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
  Panel: SettingsPanelComponent
}

type SettingsCategoryDraft = Omit<SettingsCategory, "group">
type SettingsCategorySpec = readonly [
  id: string,
  label: string,
  title: string | null,
  description: string,
  keywords: string[],
  icon: LucideIcon,
  Panel: SettingsPanelComponent,
]

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

const ACCOUNT_CATEGORIES = categoryDrafts([
  [
    "profile",
    t("Profile"),
    null,
    t("Edit your username, avatar, and sign-in methods."),
    [
      "username",
      "avatar",
      "profile picture",
      "banner",
      "passkeys",
      "linked accounts",
      "connected accounts",
      "oauth",
      "sign-in methods",
    ],
    UserIcon,
    ProfilePanel,
  ],
  [
    "personal-appearance",
    t("Appearance"),
    t("Appearance"),
    t("Color mode and theme palettes."),
    [
      "theme",
      "appearance",
      "light",
      "dark",
      "system",
      "color scheme",
      "palette",
      "catppuccin",
      "frappe",
      "latte",
      "nord",
      "one dark",
      "one light",
      "rose pine",
    ],
    PaletteIcon,
    AppearancePanel,
  ],
  [
    "preferences",
    t("General"),
    t("General"),
    t("Language and announcement settings."),
    [
      "language",
      "locale",
      "settings",
      "preferences",
      "general",
      "announcements",
      "announce clips",
      "webhooks",
      "discord",
    ],
    LanguagesIcon,
    PreferencesPanel,
  ],
  [
    "account",
    t("Account & data"),
    null,
    t("Review storage, manage your clips, or disable and delete your account."),
    [
      "storage usage",
      "quota",
      "download clips",
      "delete clips",
      "export data",
      "disable account",
      "deactivate",
      "delete account",
      "danger zone",
    ],
    DatabaseIcon,
    AccountDataPanel,
  ],
])

const DESKTOP_CATEGORIES = categoryDrafts([
  [
    "desktop",
    t("Capture"),
    t("Capture"),
    t("Game detection, hotkeys, sounds, and where clips are saved."),
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
      "capture folder",
      "disk usage",
      "storage",
      "free space",
      "clips folder",
    ],
    VideoIcon,
    DesktopCapturePanel,
  ],
  [
    "desktop-quality",
    t("Quality"),
    t("Quality"),
    t("Resolution, frame rate, encoder, and replay buffer."),
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
    t("Audio"),
    t("Audio"),
    t("Devices, microphones, application streams, and volumes."),
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
    "desktop-app",
    t("App"),
    t("App"),
    t("Manage servers, startup behavior, and desktop updates."),
    [
      "desktop servers",
      "autostart",
      "startup",
      "launch at login",
      "start with windows",
      "switch server",
      "saved servers",
      "updates",
    ],
    ServerIcon,
    DesktopAppPanel,
  ],
])

const ADMIN_CATEGORIES = categoryDrafts([
  [
    "appearance",
    t("Appearance"),
    t("Appearance"),
    t("The generated login backdrop."),
    [
      "login backdrop",
      "splash",
      "blur",
      "darkening",
      "custom backdrop",
      "regenerate",
      "branding",
    ],
    PaletteIcon,
    AdminAppearancePanel,
  ],
  [
    "authentication",
    t("Authentication"),
    t("Authentication"),
    t("Registration, passkeys, browsing access, and OAuth sign-in providers."),
    [
      "auth",
      "authentication",
      "oauth",
      "oidc",
      "sso",
      "registrations",
      "registration",
      "passkey",
      "passkeys",
      "open registrations",
      "require sign-in",
      "providers",
    ],
    KeyRoundIcon,
    AdminAuthPanel,
  ],
  [
    "transcoding",
    t("Transcoding"),
    t("Transcoding"),
    t(
      "Video codec, hardware acceleration, quality, audio, and the rendition ladder for new uploads.",
    ),
    [
      "renditions",
      "transcoding",
      "rendition ladder",
      "quality",
      "codec",
      "h264",
      "hevc",
      "av1",
      "hardware acceleration",
      "nvenc",
      "quick sync",
      "qsv",
      "vaapi",
      "videotoolbox",
      "ffmpeg",
      "jellyfin",
      "audio bitrate",
      "1080p",
      "720p",
      "480p",
      "re-encode",
    ],
    FilmIcon,
    AdminTranscodingPanel,
  ],
  [
    "users",
    t("Users"),
    null,
    t("Edit user accounts, roles, and moderation state."),
    ["user accounts", "roles", "moderation", "ban", "storage quota"],
    UsersIcon,
    AdminUsersPanel,
  ],
  [
    "games",
    t("Games"),
    null,
    t("Create custom games and manage their artwork."),
    ["games", "custom games", "artwork", "cover", "hero", "logo", "icon"],
    Gamepad2Icon,
    AdminGamesPanel,
  ],
  [
    "webhooks",
    t("Webhooks"),
    null,
    t("Announce published clips to Discord or your own endpoint."),
    [
      "webhooks",
      "discord",
      "announcements",
      "announce clips",
      "integrations",
      "signing secret",
      "hmac",
    ],
    WebhookIcon,
    AdminWebhooksPanel,
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
