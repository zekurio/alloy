import type { AdminRuntimeConfig } from "alloy-api"
import { Section, SectionContent } from "alloy-ui/components/section"
import { Switch } from "alloy-ui/components/switch"
import * as React from "react"

import { AdminUsersCard } from "@/components/admin/admin-users-card"
import { EncoderConfigCard } from "@/components/routes/admin-settings/encoder-config-card"
import { IntegrationsConfigCard } from "@/components/routes/admin-settings/integrations-config-card"
import { LimitsConfigCard } from "@/components/routes/admin-settings/limits-config-card"
import { MachineLearningConfigCard } from "@/components/routes/admin-settings/machine-learning-config-card"
import { OAuthProviderCard } from "@/components/routes/admin-settings/oauth-provider-card"
import { ScheduledTasksCard } from "@/components/routes/admin-settings/scheduled-tasks-card"
import {
  type AdminConfigContextValue,
  useAdminConfigContext,
} from "@/components/routes/settings/admin-config-context"
import {
  AppearanceSettingsContent,
  ConfigTransferContent,
} from "@/components/routes/settings/admin-tab-advanced-sections"
import { useRequireAuthStrict } from "@/lib/auth-hooks"

function AdminLoadError({ message }: { message: string }) {
  return (
    <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-3 text-sm">
      {message}
    </div>
  )
}

/**
 * Wraps a panel body that needs the loaded admin config, handling the load-error
 * and not-yet-loaded states so each panel stays focused on its own content.
 */
function withAdminConfig(
  render: (
    config: AdminRuntimeConfig,
    ctx: AdminConfigContextValue,
  ) => React.ReactNode,
) {
  return function AdminConfigPanel() {
    const ctx = useAdminConfigContext()
    if (ctx.loadError) return <AdminLoadError message={ctx.loadError} />
    if (!ctx.config) return null
    return <>{render(ctx.config, ctx)}</>
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
    <div className="not-last:border-border flex items-start justify-between gap-4 py-3 not-last:border-b first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <p className="text-foreground-dim mt-0.5 text-xs">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  )
}

export const AdminAuthenticationPanel = withAdminConfig((config, ctx) => {
  const togglePending = ctx.pendingToggleKey !== null
  return (
    <div className="flex flex-col gap-4">
      <Section>
        <SectionContent className="flex flex-col py-0">
          <ToggleRow
            title="Passkeys"
            description="Allow passkey sign-in and passkey-based account creation on supported browsers."
            checked={config.passkeyEnabled}
            onCheckedChange={ctx.onTogglePasskey}
            disabled={
              togglePending ||
              (config.passkeyEnabled &&
                !hasAnotherSignInMethod(config, "passkey"))
            }
          />
          <ToggleRow
            title="Open registrations"
            description="Allow new accounts through enabled sign-up methods. OAuth uses this to auto-create accounts on first sign-in."
            checked={config.openRegistrations}
            onCheckedChange={ctx.onToggleOpenRegistrations}
            disabled={togglePending}
          />
          <ToggleRow
            title="Require sign-in to browse"
            description="Off lets anyone view clips, games, and profiles. Uploads still need an account."
            checked={config.requireAuthToBrowse}
            onCheckedChange={ctx.onToggleRequireAuthToBrowse}
            disabled={togglePending}
          />
        </SectionContent>
      </Section>
      <hr className="border-border" />
      <OAuthProviderCard config={config} onChange={ctx.setConfig} hideHeader />
    </div>
  )
})

export const AdminTranscodingPanel = withAdminConfig((config, ctx) => (
  <EncoderConfigCard
    encoder={config.encoder}
    onChange={(next) => ctx.setConfig(next)}
    hideHeader
  />
))

export const AdminMachineLearningPanel = withAdminConfig((config, ctx) => (
  <MachineLearningConfigCard
    machineLearning={config.machineLearning}
    onChange={(next) => ctx.setConfig(next)}
    hideHeader
  />
))

export const AdminLimitsPanel = withAdminConfig((config, ctx) => (
  <LimitsConfigCard
    limits={config.limits}
    onChange={(next) => ctx.setConfig(next)}
    hideHeader
  />
))

export const AdminAppearancePanel = withAdminConfig((config, ctx) => (
  <AppearanceSettingsContent config={config} setConfig={ctx.setConfig} />
))

export const AdminIntegrationsPanel = withAdminConfig((config, ctx) => (
  <IntegrationsConfigCard
    integrations={config.integrations}
    onChange={(next) => ctx.setConfig(next)}
  />
))

export const AdminConfigTransferPanel = withAdminConfig((_config, ctx) => (
  <ConfigTransferContent setConfig={ctx.setConfig} />
))

export function AdminScheduledTasksPanel() {
  return <ScheduledTasksCard />
}

export function AdminUsersPanel() {
  const session = useRequireAuthStrict()
  const userId = session?.user.id
  if (!userId) return null
  return <AdminUsersCard currentUserId={userId} hideHeader />
}
