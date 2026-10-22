import type { PublicAuthConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { useQuery } from "@tanstack/react-query"
import { CircleAlertIcon, ExternalLinkIcon, RefreshCcwIcon } from "lucide-react"

import {
  LinkedAccountsCard,
  shouldShowLinkedAccountsCard,
} from "@/components/routes/settings/linked-accounts-card"
import { PasskeysCard } from "@/components/routes/settings/passkeys-card"
import {
  linkedAccountsQueryOptions,
  passkeysQueryOptions,
} from "@/lib/auth-query-keys"
import { alloyDesktop } from "@/lib/desktop"
import { publicOrigin } from "@/lib/env"
import { errorMessage } from "@/lib/error-message"
import { useSuspenseAuthConfig } from "@/lib/session-suspense"

function useSecurityData(config: PublicAuthConfig, enabled: boolean) {
  const accountsQuery = useQuery({
    ...linkedAccountsQueryOptions(),
    enabled,
  })

  const passkeysQuery = useQuery({
    ...passkeysQueryOptions(),
    enabled: enabled && config.passkeyEnabled,
  })

  return {
    accounts: accountsQuery.data ?? null,
    passkeys: config.passkeyEnabled ? (passkeysQuery.data ?? null) : null,
    loading:
      accountsQuery.isPending ||
      (config.passkeyEnabled && passkeysQuery.isPending),
    error: accountsQuery.error
      ? errorMessage(accountsQuery.error, t("Couldn't load accounts"))
      : config.passkeyEnabled && passkeysQuery.error
        ? errorMessage(passkeysQuery.error, t("Couldn't load passkeys"))
        : null,
    retry: async () => {
      // refetch() ignores `enabled`, so skip passkeys when they are off.
      await Promise.all([
        accountsQuery.refetch(),
        config.passkeyEnabled ? passkeysQuery.refetch() : null,
      ])
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
  const desktop = alloyDesktop()
  const security = useSecurityData(config, desktop === null)

  if (desktop) return <DesktopSecuritySettings />
  if (security.loading) return null

  if (!security.accounts) {
    return (
      <SecurityLoadError message={security.error} onRetry={security.retry} />
    )
  }

  const showLinkedAccounts = shouldShowLinkedAccountsCard(
    config,
    security.accounts,
  )
  const showPasskeys = config.passkeyEnabled && security.passkeys !== null

  return (
    <>
      {/* A failed passkey load hides the card, so offer the retry here. */}
      {security.error ? (
        <SecurityLoadError message={security.error} onRetry={security.retry} />
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

function SecurityLoadError({
  message,
  onRetry,
}: {
  message: string | null
  onRetry: () => Promise<void>
}) {
  return (
    <Callout tone="destructive">
      <CircleAlertIcon />
      <div className="flex flex-1 items-center justify-between gap-3">
        <span>{message}</span>
        <Button variant="outline" size="sm" onClick={() => void onRetry()}>
          <RefreshCcwIcon />
          {t("Try again")}
        </Button>
      </div>
    </Callout>
  )
}

function DesktopSecuritySettings() {
  const securityUrl = new URL("/?settings=profile", publicOrigin()).toString()

  return (
    <Callout>
      <ExternalLinkIcon />
      <div className="flex flex-1 items-center justify-between gap-3">
        <div>
          <p className="font-medium">
            {t("Manage sign-in methods in a browser")}
          </p>
          <p className="text-foreground-muted mt-1 text-xs">
            {t(
              "Passkeys and linked accounts stay tied to your server's web address.",
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<a href={securityUrl} target="_blank" rel="noreferrer" />}
        >
          {t("Open security settings")}
        </Button>
      </div>
    </Callout>
  )
}
