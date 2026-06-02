import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  AlertTriangleIcon,
  DatabaseIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
} from "lucide-react"

import { SectionTitle } from "@workspace/ui/components/section-head"
import { Separator } from "@workspace/ui/components/separator"
import { toast } from "@workspace/ui/lib/toast"

import type { PublicAuthConfig } from "@workspace/api"

import { AdminSettingsSections } from "@/components/routes/settings/admin-tab-content"
import { DangerZoneCard } from "@/components/routes/settings/danger-zone-card"
import {
  ClipDataCard,
  StorageUsageCard,
} from "@/components/routes/settings/data-card"
import {
  LinkedAccountsCard,
  shouldShowLinkedAccountsCard,
} from "@/components/routes/settings/linked-accounts-card"
import { PasskeysCard } from "@/components/routes/settings/passkeys-card"
import { ProfileCard } from "@/components/routes/settings/profile-card"
import { SettingsSection } from "@/components/routes/settings/settings-section"
import {
  linkedAccountsQueryOptions,
  passkeysQueryOptions,
} from "@/lib/auth-query-keys"
import { useIsAdmin, useRequireAuthStrict } from "@/lib/auth-hooks"
import { errorMessage } from "@/lib/error-message"
import { useSuspenseAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(app)/_app/_settings/settings")({
  component: ProfilePage,
})

function useSecurityData(config: PublicAuthConfig) {
  const accountsQuery = useQuery({
    ...linkedAccountsQueryOptions(),
  })

  const passkeysQuery = useQuery({
    ...passkeysQueryOptions(),
    enabled: config.passkeyEnabled,
  })

  React.useEffect(() => {
    if (accountsQuery.error) {
      toast.error(errorMessage(accountsQuery.error, "Couldn't load accounts"))
    }
  }, [accountsQuery.error])

  React.useEffect(() => {
    if (passkeysQuery.error) {
      toast.error(errorMessage(passkeysQuery.error, "Couldn't load passkeys"))
    }
  }, [passkeysQuery.error])

  return {
    accounts: accountsQuery.data ?? null,
    passkeys: config.passkeyEnabled ? (passkeysQuery.data ?? null) : null,
    loading: accountsQuery.isPending ||
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
            hasPasskeySignIn={config.passkeyEnabled &&
              (passkeys?.length ?? 0) > 0}
            onRefresh={refreshAccounts}
          />
        </div>
      )}
      {showLinkedAccounts && showPasskeys && <hr className="border-border" />}
      {showPasskeys && (
        <PasskeysCard passkeys={passkeys ?? []} onRefresh={refreshPasskeys} />
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
    <div className="flex flex-col gap-6">
      <SectionTitle>
        <SettingsIcon className="text-accent" />
        Settings
      </SectionTitle>

      <div className="flex flex-col gap-3">
        <SettingsSection
          icon={UserIcon}
          title="Profile identity"
          description="Edit your name, username, email, avatar, and banner."
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
          title="Sign-in security"
          description="Manage linked accounts and passkeys for this account."
          defaultOpen
        >
          <SecurityContent config={config} />
        </SettingsSection>

        <SettingsSection
          icon={DatabaseIcon}
          title="Clips & storage"
          description="Review storage usage, download, or remove your clips."
        >
          <div className="flex flex-col gap-4">
            <StorageUsageCard />
            <hr className="border-border" />
            <ClipDataCard />
          </div>
        </SettingsSection>

        <SettingsSection
          icon={AlertTriangleIcon}
          title="Account state"
          description="Disable this profile or permanently delete the account."
        >
          <DangerZoneCard />
        </SettingsSection>
      </div>

      {isAdmin && (
        <>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs font-medium tracking-wider text-foreground-muted uppercase">
              Administration
            </span>
            <Separator className="flex-1" />
          </div>
          <div className="flex flex-col gap-3">
            <AdminSettingsSections userId={user.id} />
          </div>
        </>
      )}
    </div>
  )
}
