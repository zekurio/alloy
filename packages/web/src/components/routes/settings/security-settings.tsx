import type { PublicAuthConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"

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

  useEffect(() => {
    if (accountsQuery.error) {
      toast.error(
        errorMessage(accountsQuery.error, t("Couldn't load accounts")),
      )
    }
  }, [accountsQuery.error])

  useEffect(() => {
    if (passkeysQuery.error) {
      toast.error(
        errorMessage(passkeysQuery.error, t("Couldn't load passkeys")),
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
    <div className="flex flex-col gap-6">
      {showLinkedAccounts && (
        <LinkedAccountsCard
          accounts={accounts}
          config={config}
          hasPasskeySignIn={
            config.passkeyEnabled && (passkeys?.length ?? 0) > 0
          }
          onRefresh={refreshAccounts}
        />
      )}
      {showLinkedAccounts && showPasskeys && <hr className="border-border" />}
      {showPasskeys && (
        <PasskeysCard passkeys={passkeys ?? []} onRefresh={refreshPasskeys} />
      )}
    </div>
  )
}
