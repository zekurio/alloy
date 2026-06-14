import type { AdminRuntimeConfig } from "@alloy/api"
import * as React from "react"

import { AdminUsersCard } from "@/components/admin/admin-users-card"
import {
  type AdminConfigContextValue,
  useAdminConfigContext,
} from "@/components/routes/settings/admin-config-context"
import { AppearanceSettingsContent } from "@/components/routes/settings/admin-tab-advanced-sections"
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

export const AdminAppearancePanel = withAdminConfig((config, ctx) => (
  <AppearanceSettingsContent config={config} setConfig={ctx.setConfig} />
))

export function AdminUsersPanel() {
  const session = useRequireAuthStrict()
  const userId = session?.user.id
  if (!userId) return null
  return <AdminUsersCard currentUserId={userId} hideHeader />
}
