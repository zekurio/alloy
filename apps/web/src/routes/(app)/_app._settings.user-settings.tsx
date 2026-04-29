import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  AlertTriangleIcon,
  DatabaseIcon,
  ShieldIcon,
  UserIcon,
} from "lucide-react"

import { toast } from "@workspace/ui/lib/toast"

import type { PublicAuthConfig } from "@workspace/api"

import { AdminSettingsSections } from "@/components/routes/settings/admin-tab-content"
import { DangerZoneCard } from "@/components/routes/settings/danger-zone-card"
import { DataCard } from "@/components/routes/settings/data-card"
import {
  LinkedAccountsCard,
  shouldShowLinkedAccountsCard,
  type LinkedAccount,
} from "@/components/routes/settings/linked-accounts-card"
import {
  PasskeysCard,
  type Passkey,
} from "@/components/routes/settings/passkeys-card"
import { ProfileCard } from "@/components/routes/settings/profile-card"
import { SettingsSection } from "@/components/routes/settings/settings-section"
import { authClient } from "@/lib/auth-client"
import { useIsAdmin, useRequireAuthStrict } from "@/lib/auth-hooks"
import { useSuspenseAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(app)/_app/_settings/user-settings")({
  component: ProfilePage,
})

function useSecurityData(config: PublicAuthConfig) {
  const accountsQuery = useQuery({
    queryKey: ["auth", "accounts"],
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts()
      if (error) throw new Error(error.message ?? "Couldn't load accounts")
      return (data ?? []) as LinkedAccount[]
    },
  })

  const passkeysQuery = useQuery({
    queryKey: ["auth", "passkeys"],
    enabled: config.passkeyEnabled,
    queryFn: async () => {
      const { data, error } = await authClient.passkey.listUserPasskeys()
      if (error) throw new Error(error.message ?? "Couldn't load passkeys")
      return (data ?? []) as Passkey[]
    },
  })

  React.useEffect(() => {
    if (accountsQuery.error) toast.error(accountsQuery.error.message)
  }, [accountsQuery.error])

  React.useEffect(() => {
    if (passkeysQuery.error) toast.error(passkeysQuery.error.message)
  }, [passkeysQuery.error])

  return {
    accounts: accountsQuery.data ?? null,
    passkeys: config.passkeyEnabled ? (passkeysQuery.data ?? null) : null,
    loading:
      accountsQuery.isPending ||
      (config.passkeyEnabled && passkeysQuery.isPending),
    refreshAccounts: async () => {
      await accountsQuery.refetch()
    },
    refreshPasskeys: async () => {
      await passkeysQuery.refetch()
    },
  }
}

function SecurityContent({ config }: { config: PublicAuthConfig }) {
  const { accounts, passkeys, loading, refreshAccounts, refreshPasskeys } =
    useSecurityData(config)

  if (loading || !accounts) return null

  const showLinkedAccounts = shouldShowLinkedAccountsCard(config, accounts)
  const showPasskeys = config.passkeyEnabled && passkeys !== null

  return (
    <div className="flex flex-col gap-4">
      {showLinkedAccounts && (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold">Sign-in methods</h2>
            <p className="mt-0.5 text-xs text-foreground-dim">
              Manage linked OAuth sign-in methods.
            </p>
          </div>
          <LinkedAccountsCard
            accounts={accounts}
            config={config}
            hasPasskeySignIn={
              config.passkeyEnabled && (passkeys?.length ?? 0) > 0
            }
            onRefresh={refreshAccounts}
          />
        </div>
      )}
      {showLinkedAccounts && showPasskeys && <hr className="border-border" />}
      {showPasskeys && (
        <PasskeysCard passkeys={passkeys!} onRefresh={refreshPasskeys} />
      )}
    </div>
  )
}

function ProfilePage() {
  const session = useRequireAuthStrict()
  const isAdmin = useIsAdmin()
  const config = useSuspenseAuthConfig()
  const user = session?.user

  if (!session || !user) return null

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold tracking-[-0.02em]">Settings</h1>

      <SettingsSection
        icon={UserIcon}
        title="Profile"
        description="Manage your display name, username, avatar, and banner."
        defaultOpen
      >
        <ProfileCard
          key={user.id}
          userId={user.id}
          initialName={user.name ?? ""}
          initialUsername={user.username ?? ""}
          image={user.image ?? ""}
          banner={(user as { banner?: string | null }).banner ?? ""}
          email={user.email ?? ""}
        />
      </SettingsSection>

      <SettingsSection
        icon={ShieldIcon}
        title="Security"
        description="Manage sign-in methods and passkeys."
      >
        <SecurityContent config={config} />
      </SettingsSection>

      <SettingsSection
        icon={DatabaseIcon}
        title="Data"
        description="Manage your storage quota and clips."
      >
        <DataCard />
      </SettingsSection>

      <SettingsSection
        icon={AlertTriangleIcon}
        title="Account"
        description="Disable or permanently delete your account."
      >
        <DangerZoneCard />
      </SettingsSection>

      {isAdmin && (
        <>
          <p className="mt-2 px-1 text-xs font-medium tracking-widest text-foreground-dim uppercase">
            Administration
          </p>
          <AdminSettingsSections userId={user.id} />
        </>
      )}
    </div>
  )
}
