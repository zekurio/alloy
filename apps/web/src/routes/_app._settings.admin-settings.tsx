import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { toast } from "@workspace/ui/components/sonner"
import { Switch } from "@workspace/ui/components/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { AdminUsersCard } from "../components/admin-users-card"
import {
  type AdminRuntimeConfig,
  fetchRuntimeConfig,
  updateRuntimeConfig,
} from "../lib/admin-api"
import { useRequireAdmin } from "../lib/auth-hooks"
import { EncoderConfigCard } from "../components/routes/admin-settings/encoder-config-card"
import { IntegrationsConfigCard } from "../components/routes/admin-settings/integrations-config-card"
import { LimitsConfigCard } from "../components/routes/admin-settings/limits-config-card"
import { OAuthProviderCard } from "../components/routes/admin-settings/oauth-provider-card"

/**
 * Admin console. The `useRequireAdmin` hook redirects non-admins as a UX
 * shortcut; every admin endpoint still re-verifies server-side.
 *
 * Chrome (AppShell, sidebar, slim header, back-link, page wrapper) is
 * provided by `_app` + `_app/_settings` — switching to/from `/user-settings`
 * keeps all of that mounted.
 */
export const Route = createFileRoute("/_app/_settings/admin-settings")({
  component: AdminPage,
})

function AdminPage() {
  const session = useRequireAdmin()
  const [config, setConfig] = React.useState<AdminRuntimeConfig | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  // Only fetch admin-only runtime config once we know the viewer is an
  // admin; non-admins are mid-redirect and we shouldn't touch the API.
  React.useEffect(() => {
    if (!session) return
    let cancelled = false
    fetchRuntimeConfig()
      .then((next) => {
        if (!cancelled) setConfig(next)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setLoadError(
          cause instanceof Error ? cause.message : "Couldn't load settings"
        )
      })
    return () => {
      cancelled = true
    }
  }, [session])

  if (!session) return null
  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {loadError}
      </div>
    )
  }
  if (!config) return null

  async function onToggleOpenRegistrations(nextEnabled: boolean) {
    setConfig((prev) =>
      prev ? { ...prev, openRegistrations: nextEnabled } : prev
    )
    try {
      const next = await updateRuntimeConfig({
        openRegistrations: nextEnabled,
      })
      setConfig(next)
      toast.success(nextEnabled ? "Registrations open" : "Registrations closed")
    } catch (cause) {
      setConfig((prev) =>
        prev ? { ...prev, openRegistrations: !nextEnabled } : prev
      )
      toast.error(cause instanceof Error ? cause.message : "Update failed")
    }
  }

  async function onToggleEmailPassword(nextEnabled: boolean) {
    setConfig((prev) =>
      prev ? { ...prev, emailPasswordEnabled: nextEnabled } : prev
    )
    try {
      const next = await updateRuntimeConfig({
        emailPasswordEnabled: nextEnabled,
      })
      setConfig(next)
      toast.success(
        nextEnabled ? "Password login enabled" : "Password login disabled"
      )
    } catch (cause) {
      setConfig((prev) =>
        prev ? { ...prev, emailPasswordEnabled: !nextEnabled } : prev
      )
      toast.error(cause instanceof Error ? cause.message : "Update failed")
    }
  }

  return (
    <Tabs defaultValue="auth">
      <TabsList className="mb-6">
        <TabsTrigger value="auth">Authentication</TabsTrigger>
        <TabsTrigger value="uploads">Uploads &amp; encoding</TabsTrigger>
        <TabsTrigger value="integrations">Integrations</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
      </TabsList>

      <TabsContent value="auth" className="flex flex-col gap-4">
        <OAuthProviderCard
          provider={config.oauthProvider}
          onChange={(next) => setConfig(next)}
        />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Email &amp; password login</CardTitle>
              <CardDescription>
                Disable login with email and password. Make sure an OAuth
                provider is set up first.
              </CardDescription>
            </div>
            <Switch
              checked={config.emailPasswordEnabled}
              onCheckedChange={onToggleEmailPassword}
              disabled={
                // Mirrors the server-side guard: refuse to disable the only
                // remaining sign-in surface.
                config.emailPasswordEnabled && config.oauthProvider === null
              }
            />
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Open registrations</CardTitle>
              <CardDescription>
                Auto-create accounts on OAuth sign-in.
              </CardDescription>
            </div>
            <Switch
              checked={config.openRegistrations}
              onCheckedChange={onToggleOpenRegistrations}
            />
          </CardHeader>
        </Card>
      </TabsContent>

      <TabsContent value="uploads" className="flex flex-col gap-4">
        <EncoderConfigCard
          encoder={config.encoder}
          onChange={(next) => setConfig(next)}
        />

        <LimitsConfigCard
          limits={config.limits}
          onChange={(next) => setConfig(next)}
        />
      </TabsContent>

      <TabsContent value="integrations" className="flex flex-col gap-4">
        <IntegrationsConfigCard
          integrations={config.integrations}
          onChange={(next) => setConfig(next)}
        />
      </TabsContent>

      <TabsContent value="users">
        <AdminUsersCard currentUserId={session.user.id} />
      </TabsContent>
    </Tabs>
  )
}
