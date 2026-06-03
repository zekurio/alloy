import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BrainCircuitIcon,
  ClapperboardIcon,
  GaugeIcon,
  ImageIcon,
  ShieldIcon,
  UsersIcon,
} from "lucide-react"

import { Section, SectionContent } from "@workspace/ui/components/section"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/lib/toast"

import { AdminUsersCard } from "@/components/admin/admin-users-card"
import { EncoderConfigCard } from "@/components/routes/admin-settings/encoder-config-card"
import { IntegrationsConfigCard } from "@/components/routes/admin-settings/integrations-config-card"
import { LimitsConfigCard } from "@/components/routes/admin-settings/limits-config-card"
import { MachineLearningConfigCard } from "@/components/routes/admin-settings/machine-learning-config-card"
import { OAuthProviderCard } from "@/components/routes/admin-settings/oauth-provider-card"
import {
  AppearanceSettingsSection,
  ConfigTransferSection,
} from "@/components/routes/settings/admin-tab-advanced-sections"
import { SettingsSection } from "@/components/routes/settings/settings-section"
import type { AdminRuntimeConfig } from "@workspace/api"
import { api } from "@/lib/api"
import { adminRuntimeConfigQueryOptions } from "@/lib/admin-query-keys"
import { errorMessage } from "@/lib/error-message"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"

function useAdminConfig() {
  const configQuery = useQuery(adminRuntimeConfigQueryOptions())
  const [config, setConfig] = React.useState<AdminRuntimeConfig | null>(null)

  React.useEffect(() => {
    if (configQuery.data) setConfig(configQuery.data)
  }, [configQuery.data])

  const loadError = configQuery.error
    ? errorMessage(configQuery.error, "Couldn't load settings")
    : null

  return { config, setConfig, loadError }
}

type BoolToggleKey =
  | "openRegistrations"
  | "passkeyEnabled"
  | "requireAuthToBrowse"

function useAdminToggles(
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>,
) {
  const [pendingKey, setPendingKey] = React.useState<BoolToggleKey | null>(null)
  const patch = async (
    key: BoolToggleKey,
    next: boolean,
    successMsg: string,
  ) => {
    if (pendingKey) return
    let previous: AdminRuntimeConfig | null = null
    setPendingKey(key)
    setConfig((prev) => {
      previous = prev
      return prev ? { ...prev, [key]: next } : prev
    })
    try {
      const updated = await api.admin.updateRuntimeConfig({ [key]: next })
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      setConfig(updated)
      toast.success(successMsg)
    } catch (cause) {
      setConfig(previous)
      toast.error(errorMessage(cause, "Update failed"))
    } finally {
      setPendingKey(null)
    }
  }
  return {
    pendingKey,
    onToggleOpenRegistrations: (next: boolean) =>
      patch(
        "openRegistrations",
        next,
        next ? "Registrations open" : "Registrations closed",
      ),
    onTogglePasskey: (next: boolean) =>
      patch(
        "passkeyEnabled",
        next,
        next ? "Passkeys enabled" : "Passkeys disabled",
      ),
    onToggleRequireAuthToBrowse: (next: boolean) =>
      patch(
        "requireAuthToBrowse",
        next,
        next ? "Sign-in required to browse" : "Public browsing enabled",
      ),
  }
}

function hasEnabledOAuthProvider(config: AdminRuntimeConfig): boolean {
  return config.oauthProviders.some((provider) => provider.enabled)
}

function hasAnotherSignInMethod(
  config: AdminRuntimeConfig,
  excluding: "passkey" | "oauth",
): boolean {
  return (
    (excluding !== "passkey" && config.passkeyEnabled) ||
    (excluding !== "oauth" && hasEnabledOAuthProvider(config))
  )
}

function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  title: string
  description: string
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 not-last:border-b not-last:border-border first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-0.5 text-xs text-foreground-dim">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  )
}

function AuthenticationSettingsSection({
  config,
  setConfig,
  onToggleOpenRegistrations,
  onTogglePasskey,
  onToggleRequireAuthToBrowse,
  pendingToggleKey,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
  onToggleOpenRegistrations: (next: boolean) => void
  onTogglePasskey: (next: boolean) => void
  onToggleRequireAuthToBrowse: (next: boolean) => void
  pendingToggleKey: BoolToggleKey | null
}) {
  const togglePending = pendingToggleKey !== null
  return (
    <SettingsSection
      icon={ShieldIcon}
      title="Authentication"
      description="Control sign-in providers, registrations, passkeys, and public browsing."
    >
      <div className="flex flex-col gap-4">
        <Section>
          <SectionContent className="flex flex-col py-0">
            <ToggleRow
              title="Passkeys"
              description="Allow passkey sign-in and passkey-based account creation on supported browsers."
              checked={config.passkeyEnabled}
              onCheckedChange={onTogglePasskey}
              disabled={togglePending ||
                (config.passkeyEnabled &&
                  !hasAnotherSignInMethod(config, "passkey"))}
            />
            <ToggleRow
              title="Open registrations"
              description="Allow new accounts through enabled sign-up methods. OAuth uses this to auto-create accounts on first sign-in."
              checked={config.openRegistrations}
              onCheckedChange={onToggleOpenRegistrations}
              disabled={togglePending}
            />
            <ToggleRow
              title="Require sign-in to browse"
              description="Off lets anyone view clips, games, and profiles. Uploads still need an account."
              checked={config.requireAuthToBrowse}
              onCheckedChange={onToggleRequireAuthToBrowse}
              disabled={togglePending}
            />
          </SectionContent>
        </Section>
        <hr className="border-border" />
        <OAuthProviderCard config={config} onChange={setConfig} hideHeader />
      </div>
    </SettingsSection>
  )
}

function EncoderSettingsSection({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
}) {
  return (
    <SettingsSection
      icon={ClapperboardIcon}
      title="Encoding pipeline"
      description="Edit hardware acceleration, processing, and playback variants."
    >
      <EncoderConfigCard
        encoder={config.encoder}
        onChange={(next) => setConfig(next)}
        hideHeader
      />
    </SettingsSection>
  )
}

function MachineLearningSettingsSection({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
}) {
  return (
    <SettingsSection
      icon={BrainCircuitIcon}
      title="ML game suggestions"
      description="Edit inference service settings and the classifier model."
    >
      <MachineLearningConfigCard
        machineLearning={config.machineLearning}
        onChange={(next) => setConfig(next)}
        hideHeader
      />
    </SettingsSection>
  )
}

function LimitsSettingsSection({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
}) {
  return (
    <SettingsSection
      icon={GaugeIcon}
      title="Limits"
      description="Edit upload caps, default storage quota, and encode queue concurrency."
    >
      <LimitsConfigCard
        limits={config.limits}
        onChange={(next) => setConfig(next)}
        hideHeader
      />
    </SettingsSection>
  )
}

function SteamGridDBSettingsSection({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
}) {
  return (
    <SettingsSection
      icon={ImageIcon}
      title="Game artwork"
      description="Edit the SteamGridDB API key used for cover art and metadata."
    >
      <IntegrationsConfigCard
        integrations={config.integrations}
        onChange={(next) => setConfig(next)}
        hideHeader
      />
    </SettingsSection>
  )
}

export function AdminSettingsSections({ userId }: { userId: string }) {
  const { config, setConfig, loadError } = useAdminConfig()
  const {
    pendingKey: pendingToggleKey,
    onToggleOpenRegistrations,
    onTogglePasskey,
    onToggleRequireAuthToBrowse,
  } = useAdminToggles(setConfig)

  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {loadError}
      </div>
    )
  }
  if (!config) return null

  return (
    <>
      <AuthenticationSettingsSection
        config={config}
        setConfig={setConfig}
        onToggleOpenRegistrations={onToggleOpenRegistrations}
        onTogglePasskey={onTogglePasskey}
        onToggleRequireAuthToBrowse={onToggleRequireAuthToBrowse}
        pendingToggleKey={pendingToggleKey}
      />
      <EncoderSettingsSection config={config} setConfig={setConfig} />
      <MachineLearningSettingsSection config={config} setConfig={setConfig} />
      <LimitsSettingsSection config={config} setConfig={setConfig} />
      <AppearanceSettingsSection config={config} setConfig={setConfig} />
      <SteamGridDBSettingsSection config={config} setConfig={setConfig} />
      <SettingsSection
        icon={UsersIcon}
        title="Users"
        description="Edit user accounts, roles, and moderation state."
      >
        <AdminUsersCard currentUserId={userId} hideHeader />
      </SettingsSection>
      <ConfigTransferSection setConfig={setConfig} />
    </>
  )
}
