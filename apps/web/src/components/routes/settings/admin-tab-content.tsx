import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { KeyRoundIcon, LinkIcon, UploadIcon, UsersIcon } from "lucide-react"

import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@workspace/ui/components/section"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/lib/toast"

import { AdminUsersCard } from "@/components/admin/admin-users-card"
import { EncoderConfigCard } from "@/components/routes/admin-settings/encoder-config-card"
import { IntegrationsConfigCard } from "@/components/routes/admin-settings/integrations-config-card"
import { LimitsConfigCard } from "@/components/routes/admin-settings/limits-config-card"
import { OAuthProviderCard } from "@/components/routes/admin-settings/oauth-provider-card"
import { SettingsSection } from "@/components/routes/settings/settings-section"
import { type AdminRuntimeConfig } from "@workspace/api"
import { api } from "@/lib/api"
import { invalidateAuthConfig } from "@/lib/session-suspense"

const adminRuntimeConfigQueryKey = ["admin", "runtime-config"] as const

function useAdminConfig() {
  const configQuery = useQuery({
    queryKey: adminRuntimeConfigQueryKey,
    queryFn: () => api.admin.fetchRuntimeConfig(),
  })
  const [config, setConfig] = React.useState<AdminRuntimeConfig | null>(null)

  React.useEffect(() => {
    if (configQuery.data) setConfig(configQuery.data)
  }, [configQuery.data])

  const loadError = configQuery.error
    ? configQuery.error instanceof Error
      ? configQuery.error.message
      : "Couldn't load settings"
    : null

  return { config, setConfig, loadError }
}

type BoolToggleKey =
  | "openRegistrations"
  | "passkeyEnabled"
  | "requireAuthToBrowse"

function useAdminToggles(
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
) {
  const router = useRouter()
  const patch = async (
    key: BoolToggleKey,
    next: boolean,
    successMsg: string
  ) => {
    let previous: AdminRuntimeConfig | null = null
    setConfig((prev) => {
      previous = prev
      return prev ? { ...prev, [key]: next } : prev
    })
    try {
      const updated = await api.admin.updateRuntimeConfig({ [key]: next })
      invalidateAuthConfig()
      void router.invalidate()
      setConfig(updated)
      toast.success(successMsg)
    } catch (cause) {
      setConfig(previous)
      toast.error(cause instanceof Error ? cause.message : "Update failed")
    }
  }
  return {
    onToggleOpenRegistrations: (next: boolean) =>
      patch(
        "openRegistrations",
        next,
        next ? "Registrations open" : "Registrations closed"
      ),
    onTogglePasskey: (next: boolean) =>
      patch(
        "passkeyEnabled",
        next,
        next ? "Passkeys enabled" : "Passkeys disabled"
      ),
    onToggleRequireAuthToBrowse: (next: boolean) =>
      patch(
        "requireAuthToBrowse",
        next,
        next ? "Sign-in required to browse" : "Public browsing enabled"
      ),
  }
}

function hasEnabledOAuthProvider(config: AdminRuntimeConfig): boolean {
  return config.oauthProvider?.enabled === true
}

function hasAnotherSignInMethod(
  config: AdminRuntimeConfig,
  excluding: "passkey" | "oauth"
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

export function AdminSettingsSections({ userId }: { userId: string }) {
  const { config, setConfig, loadError } = useAdminConfig()
  const {
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
      <SettingsSection
        icon={KeyRoundIcon}
        title="Authentication"
        description="Configure sign-in methods and access controls."
      >
        <div className="flex flex-col gap-4">
          <OAuthProviderCard config={config} onChange={setConfig} />
          <Section>
            <SectionHeader>
              <SectionTitle>Access controls</SectionTitle>
            </SectionHeader>
            <SectionContent className="flex flex-col">
              <ToggleRow
                title="Passkeys"
                description="Allow passkey sign-in and passkey-based account creation on supported browsers."
                checked={config.passkeyEnabled}
                onCheckedChange={onTogglePasskey}
                disabled={
                  config.passkeyEnabled &&
                  !hasAnotherSignInMethod(config, "passkey")
                }
              />
              <ToggleRow
                title="Open registrations"
                description="Allow new accounts through enabled sign-up methods. OAuth uses this to auto-create accounts on first sign-in."
                checked={config.openRegistrations}
                onCheckedChange={onToggleOpenRegistrations}
              />
              <ToggleRow
                title="Require sign-in to browse"
                description="Off lets anyone view clips, games, and profiles. Uploads still need an account."
                checked={config.requireAuthToBrowse}
                onCheckedChange={onToggleRequireAuthToBrowse}
              />
            </SectionContent>
          </Section>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={UploadIcon}
        title="Uploads & encoding"
        description="Configure video encoding settings and upload limits."
      >
        <div className="flex flex-col gap-4">
          <EncoderConfigCard
            encoder={config.encoder}
            onChange={(next) => setConfig(next)}
          />
          <LimitsConfigCard
            limits={config.limits}
            onChange={(next) => setConfig(next)}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        icon={LinkIcon}
        title="Integrations"
        description="Connect external services and webhooks."
      >
        <IntegrationsConfigCard
          integrations={config.integrations}
          onChange={(next) => setConfig(next)}
        />
      </SettingsSection>

      <SettingsSection
        icon={UsersIcon}
        title="Users"
        description="Manage user accounts and permissions."
      >
        <AdminUsersCard currentUserId={userId} />
      </SettingsSection>
    </>
  )
}
