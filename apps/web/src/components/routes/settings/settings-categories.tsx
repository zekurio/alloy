import { Button } from "alloy-ui/components/button"
import {
  AlertTriangleIcon,
  BrainCircuitIcon,
  ClapperboardIcon,
  DatabaseIcon,
  GaugeIcon,
  MonitorCogIcon,
  type LucideIcon,
  PaletteIcon,
  PlugIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react"
import * as React from "react"

import {
  AdminAppearancePanel,
  AdminAuthenticationPanel,
  AdminConfigTransferPanel,
  AdminIntegrationsPanel,
  AdminLimitsPanel,
  AdminMachineLearningPanel,
  AdminTranscodingPanel,
  AdminUsersPanel,
} from "@/components/routes/settings/admin-tab-content"
import { DangerZoneCard } from "@/components/routes/settings/danger-zone-card"
import {
  ClipDataCard,
  StorageUsageCard,
} from "@/components/routes/settings/data-card"
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
      initialName={user.name ?? ""}
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

function DesktopPanel() {
  const desktop = alloyDesktop()
  if (!desktop) return null

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border bg-background flex items-center justify-between gap-4 rounded-md border px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Alloy desktop settings</div>
          <p className="text-foreground-dim mt-0.5 text-xs">
            Capture, audio, storage, hotkeys, and connected servers now live in
            the desktop app.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void desktop.openSettings()}
          className="shrink-0"
        >
          <MonitorCogIcon className="size-4" />
          Open
        </Button>
      </div>
    </div>
  )
}

const ALL_CATEGORIES: SettingsCategory[] = [
  {
    id: "profile",
    label: "Profile",
    title: "Profile identity",
    description: "Edit your name, username, email, avatar, and banner.",
    keywords: [
      "display name",
      "username",
      "email",
      "avatar",
      "profile picture",
      "banner",
    ],
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
    label: "Desktop app",
    title: "Desktop app",
    description: "Open native capture, audio, storage, and server settings.",
    keywords: [
      "desktop app",
      "recording",
      "replay buffer",
      "quality",
      "codec",
      "encoder",
      "save hotkey",
      "save full sessions",
      "desktop capture",
      "capture folder",
      "audio",
      "output devices",
      "input devices",
      "microphone",
      "speakers",
      "volume",
      "applications",
      "desktop servers",
      "switch server",
      "saved servers",
    ],
    icon: MonitorCogIcon,
    group: "desktop",
    Panel: DesktopPanel,
  },
  {
    id: "authentication",
    label: "Authentication",
    description:
      "Control sign-in providers, registrations, passkeys, and public browsing.",
    keywords: [
      "passkeys",
      "open registrations",
      "require sign-in to browse",
      "oauth providers",
      "public browsing",
    ],
    icon: ShieldIcon,
    group: "admin",
    Panel: AdminAuthenticationPanel,
  },
  {
    id: "transcoding",
    label: "Transcoding",
    title: "Playback transcoding",
    description: "Edit live transcoding and hardware acceleration.",
    keywords: ["live transcoding", "hardware acceleration", "encoder", "gpu"],
    icon: ClapperboardIcon,
    group: "admin",
    Panel: AdminTranscodingPanel,
  },
  {
    id: "ml",
    label: "ML suggestions",
    title: "ML game suggestions",
    description: "Edit inference service settings and the classifier model.",
    keywords: [
      "machine learning",
      "inference service",
      "classifier model",
      "game suggestions",
    ],
    icon: BrainCircuitIcon,
    group: "admin",
    Panel: AdminMachineLearningPanel,
  },
  {
    id: "limits",
    label: "Limits",
    description: "Edit upload caps and default storage quota.",
    keywords: ["upload cap", "upload limit", "max file size", "storage quota"],
    icon: GaugeIcon,
    group: "admin",
    Panel: AdminLimitsPanel,
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
    id: "integrations",
    label: "Integrations",
    description:
      "Connect external services used by Alloy features and metadata.",
    keywords: [
      "steamgriddb",
      "api key",
      "cover art",
      "game metadata",
      "external services",
      "integrations",
    ],
    icon: PlugIcon,
    group: "admin",
    Panel: AdminIntegrationsPanel,
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
  {
    id: "config",
    label: "Config transfer",
    description: "Export or replace server runtime configuration as JSON.",
    keywords: [
      "export config",
      "import config",
      "runtime configuration",
      "json",
    ],
    icon: WrenchIcon,
    group: "admin",
    Panel: AdminConfigTransferPanel,
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
