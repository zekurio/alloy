import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { z } from "zod"

import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@workspace/ui/components/section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { toast } from "@workspace/ui/lib/toast"
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
import { type AdminRuntimeConfig } from "@workspace/api"

import { api } from "@/lib/api"
import { requireAdminBeforeLoad } from "@/lib/auth-guards"
import { useRequireAdmin } from "@/lib/auth-hooks"

const ADMIN_TABS = ["auth", "uploads", "integrations", "users"] as const
type AdminTab = (typeof ADMIN_TABS)[number]

const TAB_LABELS: Record<AdminTab, string> = {
  auth: "Authentication",
  uploads: "Uploads & encoding",
  integrations: "Integrations",
  users: "Users",
}

const searchSchema = z.object({
  tab: z.enum(ADMIN_TABS).optional(),
})

const adminRuntimeConfigQueryKey = ["admin", "runtime-config"] as const

export const Route = createFileRoute("/(app)/_app/_settings/admin-settings")({
  beforeLoad: requireAdminBeforeLoad,
  validateSearch: searchSchema,
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
  const configQuery = useQuery({
    queryKey: adminRuntimeConfigQueryKey,
    queryFn: () => api.admin.fetchRuntimeConfig(),
    enabled: Boolean(session),
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

function AdminAuthTab({
  config,
  onConfigChange,
  onToggleEmailPassword,
  onTogglePasskey,
  onToggleOpenRegistrations,
  onToggleRequireAuthToBrowse,
}: {
  config: AdminRuntimeConfig
  onConfigChange: (next: AdminRuntimeConfig) => void
  onToggleEmailPassword: (nextEnabled: boolean) => void
  onTogglePasskey: (nextEnabled: boolean) => void
  onToggleOpenRegistrations: (nextEnabled: boolean) => void
  onToggleRequireAuthToBrowse: (nextEnabled: boolean) => void
}) {
  return (
    <TabsContent value="auth" className="flex flex-col gap-3">
      <OAuthProviderCard config={config} onChange={onConfigChange} />

      <Section>
        <SectionHeader>
          <SectionTitle>Access controls</SectionTitle>
        </SectionHeader>
        <SectionContent className="flex flex-col">
          <ToggleRow
            title="Email and password"
            description="Allow existing users to sign in with email or username plus password."
            checked={config.emailPasswordEnabled}
            onCheckedChange={onToggleEmailPassword}
            disabled={
              config.emailPasswordEnabled &&
              !hasAnotherSignInMethod(config, "email")
            }
          />
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
    </TabsContent>
  )
}

function hasEnabledOAuthProvider(config: AdminRuntimeConfig): boolean {
  return config.oauthProvider?.enabled === true
}

function hasAnotherSignInMethod(
  config: AdminRuntimeConfig,
  excluding: "email" | "passkey" | "oauth"
): boolean {
  return (
    (excluding !== "email" && config.emailPasswordEnabled) ||
    (excluding !== "passkey" && config.passkeyEnabled) ||
    (excluding !== "oauth" && hasEnabledOAuthProvider(config))
  )
}

type BoolToggleKey =
  | "openRegistrations"
  | "emailPasswordEnabled"
  | "passkeyEnabled"
  | "requireAuthToBrowse"

function useAdminToggles(
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
) {
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
      setConfig(updated)
      toast.success(successMsg)
    } catch (cause) {
      setConfig(previous)
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
    onTogglePasskey: (nextEnabled: boolean) =>
      patch(
        "passkeyEnabled",
        nextEnabled,
        nextEnabled ? "Passkeys enabled" : "Passkeys disabled"
      ),
    onToggleRequireAuthToBrowse: (nextEnabled: boolean) =>
      patch(
        "requireAuthToBrowse",
        nextEnabled,
        nextEnabled ? "Sign-in required to browse" : "Public browsing enabled"
      ),
  }
}

function AdminTabSelectors({
  activeTab,
  onTabChange,
}: {
  activeTab: AdminTab
  onTabChange: (value: string | number | null) => void
}) {
  return (
    <>
      <div className="mb-3 hidden md:block">
        <TabsList className="w-max min-w-full flex-nowrap">
          {ADMIN_TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div className="mb-3 md:hidden">
        <Select value={activeTab} onValueChange={onTabChange}>
          <SelectTrigger className="w-full">
            <SelectValue>{TAB_LABELS[activeTab]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ADMIN_TABS.map((t) => (
              <SelectItem key={t} value={t}>
                {TAB_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  )
}

function AdminUploadsTab({
  config,
  onConfigChange,
}: {
  config: AdminRuntimeConfig
  onConfigChange: (next: AdminRuntimeConfig) => void
}) {
  return (
    <TabsContent value="uploads" className="flex flex-col gap-3">
      <EncoderConfigCard
        encoder={config.encoder}
        onChange={(next) => onConfigChange(next)}
      />
      <LimitsConfigCard
        limits={config.limits}
        onChange={(next) => onConfigChange(next)}
      />
    </TabsContent>
  )
}

function AdminIntegrationsTab({
  config,
  onConfigChange,
}: {
  config: AdminRuntimeConfig
  onConfigChange: (next: AdminRuntimeConfig) => void
}) {
  return (
    <TabsContent value="integrations" className="flex flex-col gap-3">
      <IntegrationsConfigCard
        integrations={config.integrations}
        onChange={(next) => onConfigChange(next)}
      />
    </TabsContent>
  )
}

function AdminUsersTab({ currentUserId }: { currentUserId: string }) {
  return (
    <TabsContent value="users">
      <AdminUsersCard currentUserId={currentUserId} />
    </TabsContent>
  )
}

function AdminPage() {
  const session = useRequireAdmin()
  const { tab: activeTab = "auth" } = Route.useSearch()
  const navigate = useNavigate()
  const { config, setConfig, loadError } = useAdminConfig(session)
  const {
    onToggleOpenRegistrations,
    onToggleEmailPassword,
    onTogglePasskey,
    onToggleRequireAuthToBrowse,
  } = useAdminToggles(setConfig)

  const setTab = React.useCallback(
    (value: string | number | null) => {
      void navigate({
        to: ".",
        search: { tab: value === "auth" ? undefined : (value as AdminTab) },
        replace: true,
      })
    },
    [navigate]
  )

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
    <Tabs value={activeTab} onValueChange={setTab}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">
          Admin settings
        </h1>
      </div>

      <AdminTabSelectors activeTab={activeTab} onTabChange={setTab} />

      <AdminAuthTab
        config={config}
        onConfigChange={setConfig}
        onToggleEmailPassword={onToggleEmailPassword}
        onTogglePasskey={onTogglePasskey}
        onToggleOpenRegistrations={onToggleOpenRegistrations}
        onToggleRequireAuthToBrowse={onToggleRequireAuthToBrowse}
      />

      <AdminUploadsTab config={config} onConfigChange={setConfig} />

      <AdminIntegrationsTab config={config} onConfigChange={setConfig} />

      <AdminUsersTab currentUserId={session.user.id} />
    </Tabs>
  )
}
