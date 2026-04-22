import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"

import { Card, CardContent } from "@workspace/ui/components/card"
import { toast } from "@workspace/ui/components/sonner"
import { Switch } from "@workspace/ui/components/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { AdminUsersCard } from "@/components/admin/admin-users-card"
import { EncoderConfigCard } from "@/components/routes/admin-settings/encoder-config-card"
import { IntegrationsConfigCard } from "@/components/routes/admin-settings/integrations-config-card"
import { LimitsConfigCard } from "@/components/routes/admin-settings/limits-config-card"
import { OAuthProviderCard } from "@/components/routes/admin-settings/oauth-provider-card"
import { ReEncodeClipsCard } from "@/components/routes/admin-settings/re-encode-clips-card"
import {
  type AdminRuntimeConfig,
  fetchRuntimeConfig,
  updateRuntimeConfig,
} from "@/lib/admin-api"
import { useRequireAdmin } from "@/lib/auth-hooks"

export const Route = createFileRoute("/(app)/_app/_settings/admin-settings")({
  component: AdminPage,
})

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

function useAdminConfig(session: ReturnType<typeof useRequireAdmin>) {
  const [config, setConfig] = React.useState<AdminRuntimeConfig | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

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

  return { config, setConfig, loadError }
}

function AdminAuthTab({
  config,
  onConfigChange,
  onToggleEmailPassword,
  onToggleOpenRegistrations,
  onToggleRequireAuthToBrowse,
}: {
  config: AdminRuntimeConfig
  onConfigChange: (next: AdminRuntimeConfig) => void
  onToggleEmailPassword: (nextEnabled: boolean) => void
  onToggleOpenRegistrations: (nextEnabled: boolean) => void
  onToggleRequireAuthToBrowse: (nextEnabled: boolean) => void
}) {
  return (
    <TabsContent value="auth" className="flex flex-col gap-4">
      <OAuthProviderCard config={config} onChange={onConfigChange} />

      <Card>
        <CardContent className="flex flex-col">
          <ToggleRow
            title="Email & password login"
            description="Requires an OAuth provider to be configured before disabling."
            checked={config.emailPasswordEnabled}
            onCheckedChange={onToggleEmailPassword}
            disabled={
              config.emailPasswordEnabled && !hasEnabledOAuthProvider(config)
            }
          />
          <ToggleRow
            title="Open registrations"
            description="Auto-create accounts on OAuth sign-in and allow manual sign-ups."
            checked={config.openRegistrations}
            onCheckedChange={onToggleOpenRegistrations}
          />
          <ToggleRow
            title="Require sign-in to browse"
            description="Off lets anyone view clips, games, and profiles. Uploads still need an account."
            checked={config.requireAuthToBrowse}
            onCheckedChange={onToggleRequireAuthToBrowse}
          />
        </CardContent>
      </Card>
    </TabsContent>
  )
}

function hasEnabledOAuthProvider(config: AdminRuntimeConfig): boolean {
  return config.oauthProvider?.enabled === true
}

type BoolToggleKey =
  | "openRegistrations"
  | "emailPasswordEnabled"
  | "requireAuthToBrowse"

function useAdminToggles(
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
) {
  const patch = async (
    key: BoolToggleKey,
    next: boolean,
    successMsg: string
  ) => {
    setConfig((prev) => (prev ? { ...prev, [key]: next } : prev))
    try {
      const updated = await updateRuntimeConfig({ [key]: next })
      setConfig(updated)
      toast.success(successMsg)
    } catch (cause) {
      setConfig((prev) => (prev ? { ...prev, [key]: !next } : prev))
      toast.error(cause instanceof Error ? cause.message : "Update failed")
    }
  }
  return {
    onToggleOpenRegistrations: (nextEnabled: boolean) =>
      patch(
        "openRegistrations",
        nextEnabled,
        nextEnabled ? "Registrations open" : "Registrations closed"
      ),
    onToggleEmailPassword: (nextEnabled: boolean) =>
      patch(
        "emailPasswordEnabled",
        nextEnabled,
        nextEnabled ? "Password login enabled" : "Password login disabled"
      ),
    onToggleRequireAuthToBrowse: (nextEnabled: boolean) =>
      patch(
        "requireAuthToBrowse",
        nextEnabled,
        nextEnabled ? "Sign-in required to browse" : "Public browsing enabled"
      ),
  }
}

function AdminPage() {
  const session = useRequireAdmin()
  const { config, setConfig, loadError } = useAdminConfig(session)
  const {
    onToggleOpenRegistrations,
    onToggleEmailPassword,
    onToggleRequireAuthToBrowse,
  } = useAdminToggles(setConfig)

  if (!session) return null
  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {loadError}
      </div>
    )
  }
  if (!config) return null

  return (
    <Tabs defaultValue="auth">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">
          Admin settings
        </h1>
      </div>
      <TabsList className="mb-4">
        <TabsTrigger value="auth">Authentication</TabsTrigger>
        <TabsTrigger value="uploads">Uploads &amp; encoding</TabsTrigger>
        <TabsTrigger value="integrations">Integrations</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
      </TabsList>

      <AdminAuthTab
        config={config}
        onConfigChange={setConfig}
        onToggleEmailPassword={onToggleEmailPassword}
        onToggleOpenRegistrations={onToggleOpenRegistrations}
        onToggleRequireAuthToBrowse={onToggleRequireAuthToBrowse}
      />

      <TabsContent value="uploads" className="flex flex-col gap-4">
        <EncoderConfigCard
          encoder={config.encoder}
          onChange={(next) => setConfig(next)}
        />
        <LimitsConfigCard
          limits={config.limits}
          onChange={(next) => setConfig(next)}
        />
        <ReEncodeClipsCard />
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
