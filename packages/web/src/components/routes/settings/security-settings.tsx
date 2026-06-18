import type { PublicAuthConfig } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useQuery } from "@tanstack/react-query"
import * as React from "react"

import {
  LinkedAccountsCard,
  shouldShowLinkedAccountsCard,
} from "@/components/routes/settings/linked-accounts-card"
import { PasskeysCard } from "@/components/routes/settings/passkeys-card"
import {
  linkedAccountsQueryOptions,
  passkeysQueryOptions,
} from "@/lib/auth-query-keys"
import { errorMessage } from "@/lib/error-message"
import { useSuspenseAuthConfig } from "@/lib/session-suspense"

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
      toast.error(
        errorMessage(accountsQuery.error, tx("Couldn't load accounts")),
      )
    }
  }, [accountsQuery.error])

  React.useEffect(() => {
    if (passkeysQuery.error) {
      toast.error(
        errorMessage(passkeysQuery.error, tx("Couldn't load passkeys")),
      )
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

export function SecuritySettings() {
  const config = useSuspenseAuthConfig()
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
            <h2 className="text-sm font-semibold">{tx("Sign-in methods")}</h2>
            <p className="text-foreground-dim mt-0.5 text-xs">
              {tx("Manage linked OAuth sign-in methods.")}
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
        <PasskeysCard passkeys={passkeys ?? []} onRefresh={refreshPasskeys} />
      )}
    </div>
  )
}
