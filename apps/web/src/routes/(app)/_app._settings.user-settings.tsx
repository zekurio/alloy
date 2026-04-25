import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { z } from "zod"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { toast } from "@workspace/ui/lib/toast"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import type { PublicAuthConfig } from "@workspace/api"

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
import { PasswordCard } from "@/components/routes/settings/password-card"
import { ProfileCard } from "@/components/routes/settings/profile-card"
import { authClient } from "@/lib/auth-client"
import { useRequireAuthStrict } from "@/lib/auth-hooks"
import { useSuspenseAuthConfig } from "@/lib/session-suspense"

const USER_TABS = ["profile", "security", "data", "account"] as const
type UserTab = (typeof USER_TABS)[number]

const TAB_LABELS: Record<UserTab, string> = {
  profile: "Profile",
  security: "Security",
  data: "Data",
  account: "Account",
}

const searchSchema = z.object({
  tab: z.enum(USER_TABS).optional(),
})

export const Route = createFileRoute("/(app)/_app/_settings/user-settings")({
  validateSearch: searchSchema,
  component: ProfilePage,
})

function UserTabSelectors({
  activeTab,
  onTabChange,
}: {
  activeTab: UserTab
  onTabChange: (value: string | number | null) => void
}) {
  return (
    <>
      <div className="mb-3 hidden md:block">
        <TabsList className="w-max min-w-full flex-nowrap">
          {USER_TABS.map((t) => (
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
            {USER_TABS.map((t) => (
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

function useSecurityData(config: PublicAuthConfig) {
  const accountsQuery = useQuery({
    queryKey: ["auth", "accounts"],
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts()
      if (error) {
        throw new Error(error.message ?? "Couldn't load accounts")
      }
      return (data ?? []) as LinkedAccount[]
    },
  })

  const passkeysQuery = useQuery({
    queryKey: ["auth", "passkeys"],
    enabled: config.passkeyEnabled,
    queryFn: async () => {
      const { data, error } = await authClient.passkey.listUserPasskeys()
      if (error) {
        throw new Error(error.message ?? "Couldn't load passkeys")
      }
      return (data ?? []) as Passkey[]
    },
  })

  React.useEffect(() => {
    if (accountsQuery.error) {
      toast.error(accountsQuery.error.message)
    }
  }, [accountsQuery.error])

  React.useEffect(() => {
    if (passkeysQuery.error) {
      toast.error(passkeysQuery.error.message)
    }
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

function SecurityTabContent({ config }: { config: PublicAuthConfig }) {
  const { accounts, passkeys, loading, refreshAccounts, refreshPasskeys } =
    useSecurityData(config)

  if (loading || !accounts) return null

  const hasPasswordAccount = accounts.some(
    (account) => account.providerId === "credential"
  )

  const showPasswordSection =
    hasPasswordAccount || shouldShowLinkedAccountsCard(config, accounts)
  const showPasskeySection = config.passkeyEnabled && passkeys !== null

  return (
    <>
      {showPasswordSection ? (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-md font-semibold tracking-[-0.005em]">
              Password
            </h2>
            <p className="mt-0.5 text-xs text-foreground-dim">
              Manage your password and linked sign-in methods.
            </p>
          </div>

          {hasPasswordAccount ? <PasswordCard /> : null}
          {shouldShowLinkedAccountsCard(config, accounts) ? (
            <LinkedAccountsCard
              accounts={accounts}
              config={config}
              onRefresh={refreshAccounts}
            />
          ) : null}
        </div>
      ) : null}

      {showPasskeySection ? (
        <div className="flex flex-col gap-3">
          {showPasswordSection ? <hr className="border-border" /> : null}
          <PasskeysCard passkeys={passkeys!} onRefresh={refreshPasskeys} />
        </div>
      ) : null}
    </>
  )
}

function ProfilePage() {
  const session = useRequireAuthStrict()
  const config = useSuspenseAuthConfig()
  const { tab: activeTab = "profile" } = Route.useSearch()
  const navigate = useNavigate()
  const user = session?.user

  const setTab = React.useCallback(
    (value: string | number | null) => {
      void navigate({
        to: ".",
        search: {
          tab: value === "profile" ? undefined : (value as UserTab),
        },
        replace: true,
      })
    },
    [navigate]
  )

  if (!session || !user) return null

  return (
    <Tabs value={activeTab} onValueChange={setTab}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">
          Profile settings
        </h1>
      </div>

      <UserTabSelectors activeTab={activeTab} onTabChange={setTab} />

      <TabsContent value="profile" className="flex flex-col gap-3">
        <ProfileCard
          key={user.id}
          userId={user.id}
          initialName={user.name ?? ""}
          initialUsername={user.username ?? ""}
          image={user.image ?? ""}
          banner={(user as { banner?: string | null }).banner ?? ""}
          email={user.email ?? ""}
        />
      </TabsContent>

      <TabsContent value="security" className="flex flex-col gap-3">
        <SecurityTabContent config={config} />
      </TabsContent>

      <TabsContent value="data" className="flex flex-col gap-3">
        <DataCard />
      </TabsContent>

      <TabsContent value="account" className="flex flex-col gap-3">
        <DangerZoneCard />
      </TabsContent>
    </Tabs>
  )
}
