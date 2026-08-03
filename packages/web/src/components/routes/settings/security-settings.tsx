import type { PublicAuthConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { useQuery } from "@tanstack/react-query"
import { CircleAlertIcon, RefreshCcwIcon } from "lucide-react"

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

  return {
    accounts: accountsQuery.data ?? null,
    passkeys: config.passkeyEnabled ? (passkeysQuery.data ?? null) : null,
    loading:
      accountsQuery.isPending ||
      (config.passkeyEnabled && passkeysQuery.isPending),
    error: accountsQuery.error
      ? errorMessage(accountsQuery.error, t("Couldn't load accounts"))
      : passkeysQuery.error
        ? errorMessage(passkeysQuery.error, t("Couldn't load passkeys"))
        : null,
    retry: async () => {
      await Promise.all([accountsQuery.refetch(), passkeysQuery.refetch()])
    },
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
  const security = useSecurityData(config)

  if (security.loading) return null

  if (!security.accounts) {
    return (
      <Callout tone="destructive">
        <CircleAlertIcon />
        <div className="flex flex-1 items-center justify-between gap-3">
          <span>{security.error}</span>
          <Button variant="outline" size="sm" onClick={security.retry}>
            <RefreshCcwIcon />
            {t("Try again")}
          </Button>
        </div>
      </Callout>
    )
  }

  const showLinkedAccounts = shouldShowLinkedAccountsCard(
    config,
    security.accounts,
  )
  const showPasskeys = config.passkeyEnabled && security.passkeys !== null

  return (
    <>
      {security.error ? (
        <Callout tone="destructive">
          <CircleAlertIcon />
          <span>{security.error}</span>
        </Callout>
      ) : null}
      {showLinkedAccounts && (
        <LinkedAccountsCard
          accounts={security.accounts}
          config={config}
          hasPasskeySignIn={
            config.passkeyEnabled && (security.passkeys?.length ?? 0) > 0
          }
          onRefresh={security.refreshAccounts}
        />
      )}
      {showPasskeys && (
        <PasskeysCard
          passkeys={security.passkeys ?? []}
          onRefresh={security.refreshPasskeys}
        />
      )}
    </>
  )
}
