import type { AdminRuntimeConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Callout } from "@alloy/ui/components/callout"
import { LoadingState } from "@alloy/ui/components/loading-state"
import type { ReactNode } from "react"

import { AdminGamesCard } from "@/components/admin/admin-games-card"
import { AdminUsersCard } from "@/components/admin/admin-users-card"
import { AdminWebhooksCard } from "@/components/admin/admin-webhooks-card"
import { AppearanceSettingsContent } from "@/components/routes/settings/admin-appearance-settings"
import { AuthSettingsContent } from "@/components/routes/settings/admin-auth-settings"
import { useAdminConfigContext } from "@/components/routes/settings/admin-config-context"
import { TranscodingSettingsContent } from "@/components/routes/settings/admin-transcoding-settings"
import { useRequireAuthStrict } from "@/lib/auth-hooks"

import { UploadLimitsSettingsContent } from "./admin-upload-limits-settings"

function AdminLoadError({ message }: { message: string }) {
  return <Callout tone="destructive">{message}</Callout>
}

/**
 * Wraps a panel body that needs the loaded admin config, handling the load-error
 * and not-yet-loaded states so each panel stays focused on its own content.
 * Loaded config wins over an error: a failed background refetch must not
 * unmount the form and drop its unsaved edits. Explains once where defaults
 * come from, so the fields only need a reset button.
 */
function withAdminConfig(render: (config: AdminRuntimeConfig) => ReactNode) {
  return function AdminConfigPanel() {
    const ctx = useAdminConfigContext()
    if (ctx.config) {
      return (
        <div className="flex flex-col gap-8">
          <p className="text-foreground-dim text-xs">
            {t(
              "ALLOY_* environment variables override Alloy's defaults, and values saved here override both. Reset a field to return it to its default.",
            )}
          </p>
          {render(ctx.config)}
        </div>
      )
    }
    if (ctx.loadError) return <AdminLoadError message={ctx.loadError} />
    return <LoadingState variant="panel" />
  }
}

export const AdminAppearancePanel = withAdminConfig((config) => (
  <AppearanceSettingsContent config={config} />
))

export const AdminAuthPanel = withAdminConfig((config) => (
  <AuthSettingsContent config={config} />
))

export const AdminUploadLimitsPanel = withAdminConfig((config) => (
  <UploadLimitsSettingsContent config={config} />
))

export const AdminTranscodingPanel = withAdminConfig((config) => (
  <TranscodingSettingsContent config={config} />
))

export function AdminUsersPanel() {
  const session = useRequireAuthStrict()
  const userId = session?.user.id
  if (!userId) return null
  return <AdminUsersCard currentUserId={userId} />
}

export function AdminGamesPanel() {
  return <AdminGamesCard />
}

export function AdminWebhooksPanel() {
  return <AdminWebhooksCard />
}
