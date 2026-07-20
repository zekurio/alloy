import type { AdminRuntimeConfig } from "@alloy/api"
import { Callout } from "@alloy/ui/components/callout"
import type { ReactNode } from "react"

import { AdminGamesCard } from "@/components/admin/admin-games-card"
import { AdminJobsCard } from "@/components/admin/admin-jobs-card"
import { AdminUsersCard } from "@/components/admin/admin-users-card"
import { AppearanceSettingsContent } from "@/components/routes/settings/admin-appearance-settings"
import { AuthSettingsContent } from "@/components/routes/settings/admin-auth-settings"
import { useAdminConfigContext } from "@/components/routes/settings/admin-config-context"
import { TranscodingSettingsContent } from "@/components/routes/settings/admin-transcoding-settings"
import { WebhooksSettingsContent } from "@/components/routes/settings/admin-webhooks-settings"
import { useRequireAuthStrict } from "@/lib/auth-hooks"

function AdminLoadError({ message }: { message: string }) {
  return <Callout tone="destructive">{message}</Callout>
}

/**
 * Wraps a panel body that needs the loaded admin config, handling the load-error
 * and not-yet-loaded states so each panel stays focused on its own content.
 */
function withAdminConfig(render: (config: AdminRuntimeConfig) => ReactNode) {
  return function AdminConfigPanel() {
    const ctx = useAdminConfigContext()
    if (ctx.loadError) return <AdminLoadError message={ctx.loadError} />
    if (!ctx.config) return null
    return <>{render(ctx.config)}</>
  }
}

export const AdminAppearancePanel = withAdminConfig((config) => (
  <AppearanceSettingsContent config={config} />
))

export const AdminAuthPanel = withAdminConfig((config) => (
  <AuthSettingsContent config={config} />
))

export const AdminTranscodingPanel = withAdminConfig((config) => (
  <TranscodingSettingsContent config={config} />
))

export const AdminWebhooksPanel = withAdminConfig((config) => (
  <WebhooksSettingsContent config={config} />
))

export function AdminUsersPanel() {
  const session = useRequireAuthStrict()
  const userId = session?.user.id
  if (!userId) return null
  return <AdminUsersCard currentUserId={userId} hideHeader />
}

export function AdminGamesPanel() {
  return <AdminGamesCard hideHeader />
}

export function AdminJobsPanel() {
  return <AdminJobsCard hideHeader />
}
